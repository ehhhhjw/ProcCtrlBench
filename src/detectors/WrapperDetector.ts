import { SessionData, MessageNode, ToolUseInfo } from '../../ClaudeCodeStructure/src/types';
import { IDetector, DetectionIssue, Severity, EvaluationConfig } from '../types/evaluation.types';
import { WrapperWorkflowInfo } from '../types/metrics.types';
import { ContentSimilarityAnalyzer } from '../analyzers/ContentSimilarityAnalyzer';
import { AstAnalyzer } from '../analyzers/AstAnalyzer';
import { ProjectAstLoader } from '../analyzers/ProjectAstLoader';
import { writePrewarn } from '../utils/Prewarn';
import { finalizeDetectorIssues } from './detector-calibration';

/**
 * Wrapper workflow detector
 * Detects workflows that merely pass input through to downstream tools without adding value
 */
export class WrapperDetector implements IDetector {
  readonly name = 'WrapperDetector';
  private sessionData: SessionData;
  private config: EvaluationConfig;
  private ast?: AstAnalyzer;
  private projectAst?: ProjectAstLoader;

  constructor(sessionData: SessionData, config: EvaluationConfig) {
    this.sessionData = sessionData;
    this.config = config;
    this.ast = new AstAnalyzer();
    this.ast.init().catch(() => { /* optional */ });
    try {
      const projectAstPath = require('path').join(process.cwd(), 'output/project-ast.json');
      this.projectAst = new ProjectAstLoader(projectAstPath);
      this.projectAst.load();
    } catch (e) {
      this.projectAst = undefined;
    }
  }

  async detect(): Promise<DetectionIssue[]> {
    const issues: DetectionIssue[] = [];

    // Identify all Agent invocations
    const agentCalls = this.identifyAgentCalls();

    // Group by agentId and count each Agent's invocations and wrapper behavior
    const agentCallGroups = new Map<string, Array<{
      agentId: string;
      initiatorUuid: string;
      toolUse: ToolUseInfo;
    }>>();

    for (const agentCall of agentCalls) {
      // Use agentName as the grouping key (if available), otherwise use agentId
      const agent = this.sessionData.agents.get(agentCall.agentId);
      const groupKey = agent?.name || agentCall.agentId;

      if (!agentCallGroups.has(groupKey)) {
        agentCallGroups.set(groupKey, []);
      }
      agentCallGroups.get(groupKey)!.push(agentCall);
    }

    // Analyze each Agent group
    for (const [groupKey, calls] of agentCallGroups) {
      // Key fix: only make a judgement for Agents invoked at least 5 times
      if (calls.length < 5) {
        continue; // Skip Agents with too few invocations
      }

      // Analyze each invocation and count wrapper behavior
      let wrapperCount = 0;
      const analyses: Array<WrapperWorkflowInfo & { isWrapper: boolean }> = [];

      for (const call of calls) {
        const analysis = this.analyzeAgentCall(call);
        analyses.push(analysis);
        if (analysis.isWrapper) {
          wrapperCount++;
        }
      }

      // Calculate the wrapper rate (what proportion of the invocations show wrapper behavior)
      const wrapperRate = wrapperCount / calls.length;

      // Prewarn when near threshold (does not raise an issue, informational only)
      if (wrapperRate >= 0.75 && wrapperRate < 0.80) {
        writePrewarn({
          metric: 'wrapperWorkflow',
          message: `Agent wrapper rate near threshold: ${(wrapperRate * 100).toFixed(0)}%`,
          details: { group: groupKey, totalCalls: calls.length },
        });
      }

      // Judgement: ≥80% warning, ≥95% error
      if (wrapperRate >= 0.80) {
        const severity = wrapperRate >= 0.95 ? Severity.Error : Severity.Warning;
        const deduction = severity === Severity.Error ? 2.0 : 1.0;

        // Use the information from the first invocation as representative
        const firstAnalysis = analyses[0];

        issues.push({
          metric: 'wrapperWorkflow',
          severity,
          message: `Redundant wrapper workflow detected: Agent "${firstAnalysis.agentName || groupKey}" in ${calls.length} invocations merely passed input through ${wrapperCount} times (${(wrapperRate * 100).toFixed(0)}%)`,
          location: {
            messageUuid: calls[0].initiatorUuid,
          },
          suggestion: `This Agent provides no added value. Consider invoking the downstream tool directly, or adding validation, transformation, or similar logic to the Agent`,
          evidence: {
            type: severity === Severity.Error ? 'strong' : 'medium',
            details: {
              agentId: firstAnalysis.agentId,
              agentName: firstAnalysis.agentName,
              totalCalls: calls.length,
              wrapperCalls: wrapperCount,
              wrapperRate,
              internalSteps: firstAnalysis.internalSteps,
              downstreamToolType: firstAnalysis.downstreamToolType,
            },
          },
          deduction,
        });
      }
    }

    return finalizeDetectorIssues(issues, this.config);
  }

  /**
   * Identifies Agent invocations
   */
  private identifyAgentCalls(): Array<{
    agentId: string;
    initiatorUuid: string;
    toolUse: ToolUseInfo;
  }> {
    const agentCalls: Array<{
      agentId: string;
      initiatorUuid: string;
      toolUse: ToolUseInfo;
    }> = [];

    // Method 1: identify via Agent tool invocations
    for (const toolUse of this.sessionData.toolUses.values()) {
      if (toolUse.name === 'Agent') {
        agentCalls.push({
          agentId: toolUse.id, // Use the tool use id as the identifier
          initiatorUuid: toolUse.messageUuid,
          toolUse,
        });
      }
    }

    // Method 2: identify via agentId and isSidechain
    for (const agent of this.sessionData.agents.values()) {
      if (agent.messageUuids.length > 0) {
        const firstMessage = this.sessionData.messages.get(agent.messageUuids[0]);
        if (firstMessage) {
          agentCalls.push({
            agentId: agent.agentId,
            initiatorUuid: firstMessage.uuid,
            toolUse: {
              id: agent.agentId,
              name: 'Agent',
              input: {},
              timestamp: agent.createdAt,
              messageId: firstMessage.messageId,
              messageUuid: firstMessage.uuid,
              agentId: agent.agentId,
              hasResult: true,
            },
          });
        }
      }
    }

    return agentCalls;
  }

  /**
   * Analyzes an Agent invocation
   */
  private analyzeAgentCall(agentCall: {
    agentId: string;
    initiatorUuid: string;
    toolUse: ToolUseInfo;
  }): WrapperWorkflowInfo & { isWrapper: boolean } {
    const agent = this.sessionData.agents.get(agentCall.agentId);
    const agentName = agent?.name;

    // Get the Agent's internal steps
    const internalSteps = this.getInternalSteps(agentCall.agentId);
    const downstreamTools = this.getDownstreamTools(internalSteps);

    // Judgement conditions
    const codeScope = this.analyzeCodeScope(downstreamTools);
    const checks = {
      fewSteps: internalSteps.length <= 1,
      singleToolType: this.hasSingleToolType(downstreamTools),
      highInputSimilarity: this.calculateInputSimilarity(agentCall.toolUse.input, downstreamTools),
      highOutputSimilarity: this.calculateOutputSimilarity(agentCall, downstreamTools),
      noValidation: !this.hasValidation(internalSteps),
      narrowCodeScope: codeScope.isNarrow,
    };

    // Additionally: a very low proportion of newly added symbols is also treated as a wrapper signal
    const symbolDeltaLow = this.hasLowSymbolDelta(agentCall, downstreamTools);
    const passedChecks = [
      checks.fewSteps,
      checks.singleToolType,
      checks.highInputSimilarity,
      checks.highOutputSimilarity,
      checks.noValidation,
      checks.narrowCodeScope,
      symbolDeltaLow,
    ].filter(v => v).length;
    const wrapperRate = passedChecks / 7;

    const isWrapper = wrapperRate >= 0.8; // At least 80% of the conditions are satisfied

    return {
      agentId: agentCall.agentId,
      agentName,
      internalSteps: internalSteps.length,
      downstreamToolType: this.getMostCommonToolType(downstreamTools),
      inputSimilarity: checks.highInputSimilarity ? 0.85 : 0.4,
      outputSimilarity: checks.highOutputSimilarity ? 0.85 : 0.4,
      wrapperRate,
      isWrapper,
    };
  }

  /**
   * Gets the Agent's internal steps
   */
  private getInternalSteps(agentId: string): MessageNode[] {
    const steps: MessageNode[] = [];

    for (const message of this.sessionData.messages.values()) {
      if (message.agentId === agentId && message.isSidechain) {
        steps.push(message);
      }
    }

    return steps.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Gets downstream tool invocations
   */
  private getDownstreamTools(steps: MessageNode[]): ToolUseInfo[] {
    const tools: ToolUseInfo[] = [];

    for (const step of steps) {
      for (const toolUse of step.toolUses) {
        // Exclude meta tools
        if (toolUse.name !== 'Agent' && toolUse.name !== 'AskUserQuestion') {
          tools.push(toolUse);
        }
      }
    }

    return tools;
  }

  /**
   * Checks whether there is only a single tool type
   */
  private hasSingleToolType(tools: ToolUseInfo[]): boolean {
    if (tools.length === 0) return true;

    const toolTypes = new Set(tools.map(t => t.name));
    return toolTypes.size === 1;
  }

  /**
   * Calculates input similarity
   */
  private calculateInputSimilarity(agentInput: any, downstreamTools: ToolUseInfo[]): boolean {
    if (downstreamTools.length === 0) return false;

    // Compare the Agent input with the input of the first downstream tool
    const firstTool = downstreamTools[0];
    const similarity = ContentSimilarityAnalyzer.calculateStructuralSimilarity(
      agentInput,
      firstTool.input
    );

    return similarity > 0.8;
  }

  /**
   * Calculates output similarity
   */
  private calculateOutputSimilarity(
    agentCall: { agentId: string; toolUse: ToolUseInfo },
    downstreamTools: ToolUseInfo[]
  ): boolean {
    if (downstreamTools.length === 0) return false;

    // Get the Agent's output
    const agentResult = this.sessionData.toolResults.get(agentCall.toolUse.id);
    if (!agentResult) return false;

    // Get the output of the last downstream tool
    const lastTool = downstreamTools[downstreamTools.length - 1];
    const lastToolResult = this.sessionData.toolResults.get(lastTool.id);
    if (!lastToolResult) return false;

    // Compare the contents
    const agentContent = this.extractContent(agentResult.content);
    const toolContent = this.extractContent(lastToolResult.content);

    const similarity = ContentSimilarityAnalyzer.calculateSimilarity(agentContent, toolContent);

    return similarity > 0.8;
  }

  /**
   * Whether the proportion of newly added symbols in the Agent output relative to the final downstream output is very low.
   */
  private hasLowSymbolDelta(
    agentCall: { agentId: string; toolUse: ToolUseInfo },
    downstreamTools: ToolUseInfo[]
  ): boolean {
    if (!this.ast || downstreamTools.length === 0) return false;
    const agentResult = this.sessionData.toolResults.get(agentCall.toolUse.id);
    const lastTool = downstreamTools[downstreamTools.length - 1];
    const lastToolResult = this.sessionData.toolResults.get(lastTool.id);
    if (!agentResult || !lastToolResult) return false;
    const a = this.extractContent(agentResult.content);
    const b = this.extractContent(lastToolResult.content);
    const as = this.ast.extractSymbols(a);
    const bs = this.ast.extractSymbols(b);
    const aset = new Set([
      ...as.classes,
      ...as.functions,
      ...as.methods,
      ...(as.properties || []),
      ...(as.variables || []),
    ]);
    const bset = new Set([
      ...bs.classes,
      ...bs.functions,
      ...bs.methods,
      ...(bs.properties || []),
      ...(bs.variables || []),
    ]);
    if (aset.size === 0) return true; // No newly added symbols
    let newSym = 0;
    for (const s of aset) if (!bset.has(s)) newSym++;
    const addedRatio = newSym / aset.size;
    return addedRatio < 0.2;
  }

  /**
   * Checks whether validation logic is present
   */
  private hasValidation(steps: MessageNode[]): boolean {
    // Check for validation-related tool invocations
    const validationTools = ['Bash', 'Agent'];
    let validationCount = 0;

    for (const step of steps) {
      for (const toolUse of step.toolUses) {
        if (validationTools.includes(toolUse.name)) {
          // Check whether it is a test/validation command
          if (toolUse.name === 'Bash') {
            const command = toolUse.input.command || '';
            if (command.includes('test') || command.includes('check') || command.includes('verify')) {
              validationCount++;
            }
          }
        }
      }

      // Check whether the assistant message contains validation logic
      if (step.type === 'assistant') {
        const content = this.extractContent(step.content);
        if (content.includes('verify') || content.includes('check') || content.includes('confirm')) {
          validationCount++;
        }
      }
    }

    return validationCount > 0;
  }

  private analyzeCodeScope(tools: ToolUseInfo[]): { touchedFiles: string[]; touchedSymbols: string[]; isNarrow: boolean } {
    const touchedFiles = new Set<string>();
    const touchedSymbols = new Set<string>();

    for (const tool of tools) {
      for (const file of this.extractToolPaths(tool)) {
        touchedFiles.add(file);
        if (this.projectAst) {
          for (const symbol of this.projectAst.getDeclaredSymbols(file)) {
            touchedSymbols.add(symbol);
          }
        }
      }

      const result = this.sessionData.toolResults.get(tool.id);
      if (result && this.ast) {
        const extracted = this.ast.extractSymbols(this.extractContent(result.content), {
          filePath: tool.input.file_path || tool.input.path,
        });
        for (const sym of [
          ...extracted.classes,
          ...extracted.functions,
          ...extracted.methods,
          ...(extracted.properties || []),
          ...(extracted.variables || []),
          ...(extracted.calls || []),
        ]) {
          if (sym) {
            touchedSymbols.add(sym);
          }
        }
      }
    }

    const normalizedFiles = Array.from(touchedFiles);
    let neighborhoodSize = normalizedFiles.length;
    if (this.projectAst) {
      const neighborhood = new Set<string>();
      for (const file of normalizedFiles) {
        neighborhood.add(file);
        for (const related of this.projectAst.getRelatedFiles(file, true)) {
          neighborhood.add(related);
        }
      }
      neighborhoodSize = neighborhood.size;
    }

    const isNarrow = normalizedFiles.length <= 1 && neighborhoodSize <= 3 && touchedSymbols.size <= 8;
    return {
      touchedFiles: normalizedFiles,
      touchedSymbols: Array.from(touchedSymbols),
      isNarrow,
    };
  }

  private extractToolPaths(toolUse: ToolUseInfo): string[] {
    const paths = new Set<string>();
    for (const key of ['file_path', 'path']) {
      const value = toolUse.input?.[key];
      if (typeof value === 'string' && value) {
        paths.add(value);
      }
    }
    return Array.from(paths);
  }

  /**
   * Gets the most common tool type
   */
  private getMostCommonToolType(tools: ToolUseInfo[]): string {
    if (tools.length === 0) return 'unknown';

    const counts = new Map<string, number>();

    for (const tool of tools) {
      counts.set(tool.name, (counts.get(tool.name) || 0) + 1);
    }

    let maxCount = 0;
    let mostCommon = 'unknown';

    for (const [toolName, count] of counts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = toolName;
      }
    }

    return mostCommon;
  }

  /**
   * Extracts content
   */
  private extractContent(content: any): string {
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
}
