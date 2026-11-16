import { SessionData, ToolUseInfo, MessageNode } from '../../ClaudeCodeStructure/src/types';
import { IDetector, DetectionIssue, Severity, EvaluationConfig } from '../types/evaluation.types';
import { DeadStepInfo } from '../types/metrics.types';
import { ContentSimilarityAnalyzer } from '../analyzers/ContentSimilarityAnalyzer';
import { FileAssociationLoader } from '../analyzers/FileAssociationLoader';
import { AstAnalyzer } from '../analyzers/AstAnalyzer';
import { ProjectAstLoader } from '../analyzers/ProjectAstLoader';
import { ContextChainAnalyzer } from '../analyzers/ContextChainAnalyzer';
import { finalizeDetectorIssues } from './detector-calibration';

/**
 * Dead step detector
 * Detects steps whose results are never effectively referenced by the subsequent flow
 */
export class DeadStepDetector implements IDetector {
  readonly name = 'DeadStepDetector';
  private sessionData: SessionData;
  private config: EvaluationConfig;
  private fileGraph?: FileAssociationLoader;
  private ast?: AstAnalyzer;
  private projectAst?: ProjectAstLoader;
  private contextChains: ContextChainAnalyzer;

  constructor(sessionData: SessionData, config: EvaluationConfig) {
    this.sessionData = sessionData;
    this.config = config;
    // Try to load the file graph (optional)
    try {
      const graphPath = require('path').join(process.cwd(), 'output/file-graph.json');
      this.fileGraph = new FileAssociationLoader(graphPath);
      this.fileGraph.load();
    } catch (e) {
      this.fileGraph = undefined;
    }
    try {
      const projectAstPath = require('path').join(process.cwd(), 'output/project-ast.json');
      this.projectAst = new ProjectAstLoader(projectAstPath);
      this.projectAst.load();
    } catch (e) {
      this.projectAst = undefined;
    }
    // Initialize the AST analyzer (optional)
    this.ast = new AstAnalyzer();
    this.ast.init().catch(() => { /* ignore */ });
    this.contextChains = new ContextChainAnalyzer(this.sessionData);
  }

  async detect(): Promise<DetectionIssue[]> {
    const issues: DetectionIssue[] = [];

    // Get all tool invocations sorted by time
    const toolUses = Array.from(this.sessionData.toolUses.values())
      .sort((a, b) => a.timestamp - b.timestamp);
    const orderedMessages = Array.from(this.sessionData.messages.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    for (let i = 0; i < toolUses.length; i++) {
      const toolUse = toolUses[i];
      const toolResult = this.sessionData.toolResults.get(toolUse.id);

      // Only check tool invocations that produced a result
      if (!toolResult || toolResult.is_error) {
        continue;
      }

      // Write operations already have a lasting effect on external state, so they should not be judged as a dead step.
      if (toolUse.name === 'Write') {
        continue;
      }

      if (this.isFinalCodeModificationStep(toolUse, toolUses, i)) {
        continue;
      }

      // Get the subsequent steps
      const subsequentSteps = this.getSubsequentSteps(toolUse, toolUses.slice(i + 1));
      const subsequentMessages = this.getSubsequentMessages(toolUse, orderedMessages);
      const context = this.buildCodeContext(toolUse, toolResult);
      const hasContextCarry = this.isCarriedInSubsequentContext(toolUse, subsequentMessages);

      // Check the 4 conditions
      const checks = {
        noToolInputRef: !this.isReferencedInToolInputs(toolResult, subsequentSteps, context),
        noPlanRef: !this.isReferencedInPlans(toolResult, subsequentMessages, context),
        noFileRef: !this.isReferencedInFileOps(toolResult, subsequentSteps, context),
        noBranchImpact: !this.causedBranchChange(toolUse, subsequentSteps),
      };

      // Compute the evidence strength
      const failedChecks = Object.values(checks).filter(v => v).length;

      if (failedChecks >= 3) {
        if (hasContextCarry && failedChecks === 3) {
          continue;
        }

        // Strong evidence or medium evidence
        const evidenceType = failedChecks === 4 && !hasContextCarry ? 'strong' : 'medium';
        const severity = failedChecks === 4 && !hasContextCarry ? Severity.Error : Severity.Warning;
        const deduction = evidenceType === 'strong' ? 1.0 : 0.5;

        issues.push({
          metric: 'deadStep',
          severity,
          message: `Detected dead step: the result of ${toolUse.name} is not effectively referenced by the subsequent flow (${failedChecks}/4 checks failed)`,
          location: {
            stepRange: [i, i],
            toolUseId: toolUse.id,
            messageUuid: toolUse.messageUuid,
          },
          suggestion: `The result of this step appears to be unused. Consider removing this step or ensuring its result is referenced by subsequent steps`,
          evidence: {
            type: evidenceType,
            details: {
              toolName: toolUse.name,
                checks,
                failedChecks,
                hasContextCarry,
                resultPreview: this.getResultPreview(toolResult),
              },
            },
            deduction,
        });
      }
    }

    return finalizeDetectorIssues(issues, this.config);
  }

  private isFinalCodeModificationStep(
    toolUse: ToolUseInfo,
    orderedToolUses: ToolUseInfo[],
    index: number
  ): boolean {
    return this.isCodeModificationStep(toolUse) && index === orderedToolUses.length - 1;
  }

  private isCodeModificationStep(toolUse: ToolUseInfo): boolean {
    return toolUse.name === 'Write' || toolUse.name === 'Edit' || toolUse.name === 'MultiEdit';
  }

  /**
   * Get the subsequent steps
   */
  private getSubsequentSteps(
    currentToolUse: ToolUseInfo,
    remainingToolUses: ToolUseInfo[]
  ): Array<{ toolUse: ToolUseInfo; message: MessageNode }> {
    const steps: Array<{ toolUse: ToolUseInfo; message: MessageNode }> = [];

    const checkWindow = remainingToolUses
      .filter((toolUse) => this.contextChains.isDescendant(toolUse.messageUuid, currentToolUse.messageUuid))
      .slice(0, 10);

    for (const toolUse of checkWindow) {
      const message = this.sessionData.messages.get(toolUse.messageUuid);
      if (message) {
        steps.push({ toolUse, message });
      }
    }

    return steps;
  }

  private getSubsequentMessages(
    currentToolUse: ToolUseInfo,
    orderedMessages: MessageNode[]
  ): MessageNode[] {
    return orderedMessages.filter((message) =>
      this.contextChains.isDescendant(message.uuid, currentToolUse.messageUuid)
    );
  }

  /**
   * Check whether it is referenced in subsequent tool inputs
   */
  private isReferencedInToolInputs(
    toolResult: any,
    subsequentSteps: Array<{ toolUse: ToolUseInfo; message: MessageNode }>,
    context: { files: Set<string>; symbols: Set<string>; keywords: string[] }
  ): boolean {
    const resultContent = this.extractResultContent(toolResult);
    if (!resultContent) return false;

    for (const step of subsequentSteps) {
      const inputStr = JSON.stringify(step.toolUse.input);

      // Check whether it contains keywords from the result
      for (const keyword of context.keywords) {
        if (inputStr.includes(keyword)) {
          return true;
        }
      }

      // Symbol-level reference: a class/function/method name appears in subsequent inputs
      for (const sym of context.symbols) {
        if (sym && inputStr.includes(sym)) {
          return true;
        }
      }

      if (this.stepTouchesCodeContext(step.toolUse, context)) {
        return true;
      }

      // Check file path references
      if (step.toolUse.name === 'Read' || step.toolUse.name === 'Edit' || step.toolUse.name === 'Write') {
        const filePath = step.toolUse.input.file_path;
        if (filePath) {
          if (resultContent.includes(filePath)) return true;
        }
      }
    }

    return false;
  }

  /**
   * Check whether it is referenced in subsequent plans/reasoning
   */
  private isReferencedInPlans(
    toolResult: any,
    subsequentMessages: MessageNode[],
    context: { files: Set<string>; symbols: Set<string>; keywords: string[] }
  ): boolean {
    const resultContent = this.extractResultContent(toolResult);
    if (!resultContent) return false;

    for (const message of subsequentMessages) {
      // Check the text content of assistant messages
      if (message.type === 'assistant') {
        const messageText = this.extractMessageText(message.content);

        for (const keyword of context.keywords) {
          if (messageText.includes(keyword)) {
            return true;
          }
        }

        for (const sym of context.symbols) {
          if (sym && messageText.includes(sym)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Check whether it is referenced in subsequent file operations
   */
  private isReferencedInFileOps(
    toolResult: any,
    subsequentSteps: Array<{ toolUse: ToolUseInfo; message: MessageNode }>,
    context: { files: Set<string>; symbols: Set<string>; keywords: string[] }
  ): boolean {
    // Extract the file paths mentioned in the result
    const resultContent = this.extractResultContent(toolResult);
    const filePaths = this.extractFilePaths(resultContent);
    for (const file of context.files) {
      filePaths.push(file);
    }

    if (filePaths.length === 0 && context.symbols.size === 0) return false;

    for (const step of subsequentSteps) {
      // Check whether the related files were operated on
      if (step.toolUse.name === 'Read' || step.toolUse.name === 'Edit' || step.toolUse.name === 'Write') {
        const targetFile = step.toolUse.input.file_path;

        if (targetFile) {
          for (const filePath of filePaths) {
            if (targetFile.includes(filePath)) return true;
            if (this.fileGraph) {
              const assoc = this.fileGraph.get(filePath);
              if (assoc.includes(targetFile)) return true;
            }
            if (this.projectAst?.areFilesRelated(filePath, targetFile)) return true;
          }

          if (context.symbols.size > 0 && this.projectAst) {
            if (this.projectAst.fileDefinesAnySymbol(targetFile, context.symbols)) {
              return true;
            }
            if (this.projectAst.fileUsesAnySymbol(targetFile, context.symbols)) {
              return true;
            }
          }
        }
      }
    }

    return false;
  }

  /**
   * Check whether it caused a branch change
   */
  private causedBranchChange(
    toolUse: ToolUseInfo,
    subsequentSteps: Array<{ toolUse: ToolUseInfo; message: MessageNode }>
  ): boolean {
    // Check whether a new Agent was created
    const beforeAgents = new Set<string>();
    const afterAgents = new Set<string>();

    // Count the agents before and after this step
    for (const [agentId, agent] of this.sessionData.agents.entries()) {
      if (agent.createdAt < toolUse.timestamp) {
        beforeAgents.add(agentId);
      } else if (agent.createdAt > toolUse.timestamp) {
        afterAgents.add(agentId);
      }
    }

    // If a new agent was created, it may be an effect of this step
    if (afterAgents.size > beforeAgents.size) {
      // Check whether the new agent falls within a reasonable time window
      for (const agentId of afterAgents) {
        const agent = this.sessionData.agents.get(agentId);
        if (agent && Math.abs(agent.createdAt - toolUse.timestamp) < 10000) { // Within 10 seconds
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check whether this step is still inherited by the context chain of subsequent steps.
   * This is a weak usage signal: it indicates the result remains in the subsequent reasoning context,
   * but it is not equivalent to explicit consumption.
   */
  private isCarriedInSubsequentContext(
    toolUse: ToolUseInfo,
    subsequentMessages: MessageNode[]
  ): boolean {
    return subsequentMessages.some((message) =>
      this.contextChains.getChainUuids(message.uuid).includes(toolUse.messageUuid)
    );
  }

  /**
   * Extract the result content
   */
  private extractResultContent(result: any): string {
    if (typeof result.content === 'string') {
      return result.content;
    }

    if (Array.isArray(result.content)) {
      return result.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('\n');
    }

    return '';
  }

  /**
   * Extract keywords
   */
  private extractKeywords(content: string): string[] {
    // Extract meaningful words (length >= 4)
    const words = content
      .split(/\s+/)
      .map(w => w.replace(/[^\w]/g, ''))
      .filter(w => w.length >= 4 && !/^\d+$/.test(w)); // Exclude purely numeric tokens

    // Deduplicate and return the first 20
    return [...new Set(words)].slice(0, 20);
  }

  /**
   * Extract the message text
   */
  private extractMessageText(content: any): string {
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text || '')
        .join('\n');
    }

    return '';
  }

  /**
   * Extract file paths
   */
  private extractFilePaths(content: string): string[] {
    const paths: string[] = [];

    // Match common file path patterns
    const pathPatterns = [
      /[\w\/\-\.]+\.[a-zA-Z]{1,4}/g, // Paths with an extension
      /src\/[\w\/\-\.]+/g,             // Paths under the src directory
      /\/[\w\/\-\.]+/g,                // Absolute paths
    ];

    for (const pattern of pathPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        paths.push(...matches);
      }
    }

    return [...new Set(paths)];
  }

  private buildCodeContext(toolUse: ToolUseInfo, toolResult: any): { files: Set<string>; symbols: Set<string>; keywords: string[] } {
    const resultContent = this.extractResultContent(toolResult);
    const files = new Set<string>([
      ...this.extractToolPaths(toolUse),
      ...this.extractFilePaths(resultContent),
    ]);

    const keywords = this.extractKeywords(resultContent);
    const symbols = new Set<string>();
    const extracted = this.ast ? this.ast.extractSymbols(resultContent, { filePath: toolUse.input.file_path }) : undefined;
    if (extracted) {
      for (const sym of [
        ...extracted.classes,
        ...extracted.functions,
        ...extracted.methods,
        ...(extracted.properties || []),
        ...(extracted.variables || []),
        ...(extracted.calls || []),
      ]) {
        if (sym) {
          symbols.add(sym);
        }
      }
    }

    if (this.projectAst) {
      for (const file of [...files]) {
        for (const declared of this.projectAst.getDeclaredSymbols(file)) {
          symbols.add(declared);
        }
      }
    }

    return { files, symbols, keywords };
  }

  private extractToolPaths(toolUse: ToolUseInfo): string[] {
    const paths = new Set<string>();
    const input = toolUse.input || {};
    for (const key of ['file_path', 'path']) {
      if (typeof input[key] === 'string' && input[key]) {
        paths.add(input[key]);
      }
    }
    return Array.from(paths);
  }

  private stepTouchesCodeContext(
    toolUse: ToolUseInfo,
    context: { files: Set<string>; symbols: Set<string>; keywords: string[] }
  ): boolean {
    const targetFiles = this.extractToolPaths(toolUse);
    if (targetFiles.length === 0) {
      return false;
    }

    for (const targetFile of targetFiles) {
      if (context.files.has(targetFile)) {
        return true;
      }
      for (const sourceFile of context.files) {
        if (this.projectAst?.areFilesRelated(sourceFile, targetFile)) {
          return true;
        }
        if (this.fileGraph?.get(sourceFile).includes(targetFile)) {
          return true;
        }
      }

      if (this.projectAst) {
        if (this.projectAst.fileDefinesAnySymbol(targetFile, context.symbols)) {
          return true;
        }
        if (this.projectAst.fileUsesAnySymbol(targetFile, context.symbols)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Get a preview of the result
   */
  private getResultPreview(result: any): string {
    const content = this.extractResultContent(result);
    return content.length > 100 ? content.substring(0, 100) + '...' : content;
  }
}
