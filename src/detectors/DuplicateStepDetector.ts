import { SessionData, ToolUseInfo } from '../../ClaudeCodeStructure/src/types';
import { IDetector, DetectionIssue, Severity, EvaluationConfig } from '../types/evaluation.types';
import { DuplicateStepInfo } from '../types/metrics.types';
import { ContentSimilarityAnalyzer } from '../analyzers/ContentSimilarityAnalyzer';
import { FileAssociationLoader } from '../analyzers/FileAssociationLoader';
import { AstAnalyzer } from '../analyzers/AstAnalyzer';
import { ProjectAstLoader } from '../analyzers/ProjectAstLoader';
import { finalizeDetectorIssues } from './detector-calibration';

/**
 * Duplicate step detector
 * Detects duplicate steps performed on the same resource while its state remained unchanged
 */
export class DuplicateStepDetector implements IDetector {
  readonly name = 'DuplicateStepDetector';
  private sessionData: SessionData;
  private config: EvaluationConfig;
  private fileChangeTimestamps: Map<string, number> = new Map();
  private fileGraph?: FileAssociationLoader;
  private ast?: AstAnalyzer;
  private projectAst?: ProjectAstLoader;

  constructor(sessionData: SessionData, config: EvaluationConfig) {
    this.sessionData = sessionData;
    this.config = config;
    this.buildFileChangeHistory();
    // Optional: file graph
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
    // Optional: AST
    this.ast = new AstAnalyzer();
    this.ast.init().catch(() => { /* ignore */ });
  }

  /**
   * Build the file change history
   */
  private buildFileChangeHistory(): void {
    const toolUses = Array.from(this.sessionData.toolUses.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    for (const toolUse of toolUses) {
      // Record the file write time
      if (toolUse.name === 'Write' || toolUse.name === 'Edit') {
        const filePath = toolUse.input.file_path;
        if (filePath) {
          this.fileChangeTimestamps.set(filePath, toolUse.timestamp);
        }
      }
    }
  }

  async detect(): Promise<DetectionIssue[]> {
    const issues: DetectionIssue[] = [];

    // Get all tool invocations sorted by time
    const toolUses = Array.from(this.sessionData.toolUses.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    // Check each tool invocation for duplicates
    for (let i = 0; i < toolUses.length; i++) {
      const currentToolUse = toolUses[i];

      // Find similar earlier invocations
      const duplicates = this.findSimilarCalls(currentToolUse, toolUses.slice(0, i));

      for (const dup of duplicates) {
        issues.push(this.createDuplicateIssue(dup, currentToolUse, i, dup.previousIndex));
      }
    }

    return finalizeDetectorIssues(issues, this.config);
  }

  /**
   * Find similar earlier invocations
   */
  private findSimilarCalls(
    currentToolUse: ToolUseInfo,
    previousToolUses: ToolUseInfo[]
  ): Array<DuplicateStepInfo & { previousIndex: number }> {
    const duplicates: Array<DuplicateStepInfo & { previousIndex: number }> = [];

    for (let i = previousToolUses.length - 1; i >= 0; i--) {
      const prevToolUse = previousToolUses[i];

      // Only compare tools of the same type
      if (prevToolUse.name !== currentToolUse.name) continue;

      // Compute the input similarity
      const inputSimilarity = ContentSimilarityAnalyzer.calculateStructuralSimilarity(
        prevToolUse.input,
        currentToolUse.input
      );

      // If the input similarity exceeds 90%
      if (inputSimilarity > 0.9) {
        // Check whether the file changed in between
        const hasFileChanged = this.hasFileChangedBetween(
          prevToolUse,
          currentToolUse
        );

        // If the file did not change, check the result similarity
        if (!hasFileChanged) {
          const prevResult = this.sessionData.toolResults.get(prevToolUse.id);
          const currentResult = this.sessionData.toolResults.get(currentToolUse.id);

          let resultSimilarity = 0;

          if (prevResult && currentResult) {
            const prevContent = this.extractResultContent(prevResult);
            const currentContent = this.extractResultContent(currentResult);

            resultSimilarity = ContentSimilarityAnalyzer.calculateSimilarity(
              prevContent,
              currentContent
            );
          }

          const prevContent = prevResult ? this.extractResultContent(prevResult) : '';
          const currentContent = currentResult ? this.extractResultContent(currentResult) : '';
          const semanticDuplicate = this.isSemanticDuplicate(prevContent, currentContent, currentToolUse);

          // If the results are also highly similar, or highly repetitive at the symbol/call level, treat it as a duplicate
          if (resultSimilarity > 0.9 || semanticDuplicate || (!prevResult && !currentResult)) {
            // Check the exemption conditions
            if (!this.isExempt(currentToolUse)) {
              const type = inputSimilarity === 1.0 ? 'exact' : 'near';

              duplicates.push({
                type,
                currentStep: -1, // Will be filled in externally
                previousStep: i,
                previousIndex: i,
                toolName: currentToolUse.name,
                inputSimilarity,
                resultSimilarity,
                timeDelta: currentToolUse.timestamp - prevToolUse.timestamp,
              });
            }
          }
        }
      }
    }

    return duplicates;
  }

  /**
   * Check whether the file changed in between
   */
  private hasFileChangedBetween(
    prevToolUse: ToolUseInfo,
    currentToolUse: ToolUseInfo
  ): boolean {
    // Extract the files involved
    const files = new Set(this.extractFilePaths(currentToolUse.input));
    if (this.projectAst) {
      for (const file of [...files]) {
        for (const related of this.projectAst.getRelatedFiles(file, true)) {
          files.add(related);
        }
      }
    }

    for (const file of files) {
      const changeTime = this.fileChangeTimestamps.get(file);

      if (changeTime && changeTime > prevToolUse.timestamp && changeTime < currentToolUse.timestamp) {
        return true;
      }
      // Indirect change: if an associated file was written, treat it as a change too
      if (this.fileGraph) {
        const assoc = this.fileGraph.get(file);
        for (const af of assoc) {
          const changeTime2 = this.fileChangeTimestamps.get(af);
          if (changeTime2 && changeTime2 > prevToolUse.timestamp && changeTime2 < currentToolUse.timestamp) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Extract file paths
   */
  private extractFilePaths(input: any): string[] {
    const files: string[] = [];

    if (input.file_path) {
      files.push(input.file_path);
    }
    if (input.path) {
      files.push(input.path);
    }

    return files;
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
   * Semantic duplication enhancement: compare symbol overlap to confirm duplication at the semantic level.
   */
  private isSemanticDuplicate(prevContent: string, currContent: string, currentToolUse?: ToolUseInfo): boolean {
    if (!this.ast) return false;
    const filePath = currentToolUse?.input?.file_path || currentToolUse?.input?.path;
    const ps = this.ast.extractSymbols(prevContent, { filePath });
    const cs = this.ast.extractSymbols(currContent, { filePath });
    const pset = new Set([
      ...ps.classes,
      ...ps.functions,
      ...ps.methods,
      ...(ps.properties || []),
      ...(ps.variables || []),
      ...(ps.calls || []),
    ]);
    const cset = new Set([
      ...cs.classes,
      ...cs.functions,
      ...cs.methods,
      ...(cs.properties || []),
      ...(cs.variables || []),
      ...(cs.calls || []),
    ]);
    if (filePath && this.projectAst) {
      for (const sym of this.projectAst.getDeclaredSymbols(filePath)) {
        pset.add(sym);
        cset.add(sym);
      }
    }
    let inter = 0;
    for (const s of pset) if (cset.has(s)) inter++;
    const jaccard = (inter) / (pset.size + cset.size - inter || 1);
    return jaccard > 0.8;
  }

  /**
   * Check the exemption conditions
   */
  private isExempt(toolUse: ToolUseInfo): boolean {
    // Exemption condition 1: commands that are inherently time-varying (e.g. git status, time-related commands)
    if (toolUse.name === 'Bash') {
      const command = toolUse.input.command;
      const timeVariantCommands = [
        'git status',
        'git log',
        'ps',
        'top',
        'date',
        'uptime',
      ];

      if (timeVariantCommands.some(cmd => command.includes(cmd))) {
        return true;
      }
    }

    // Exemption condition 2: verification-oriented repetition (test commands)
    if (toolUse.name === 'Bash') {
      const command = toolUse.input.command;
      const testCommands = ['npm test', 'yarn test', 'pytest', 'jest', 'cargo test'];

      if (testCommands.some(cmd => command.includes(cmd))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Create a duplicate issue
   */
  private createDuplicateIssue(
    dup: DuplicateStepInfo,
    currentToolUse: ToolUseInfo,
    currentIndex: number,
    previousIndex: number
  ): DetectionIssue {
    const isExact = dup.type === 'exact';
    const isHighCost = this.isHighCostTool(currentToolUse.name);

    const severity = (isExact && isHighCost) || dup.type === 'context_loss'
      ? Severity.Error
      : Severity.Warning;

    const deduction = severity === Severity.Error ? 1.5 : 0.5;

    return {
      metric: 'duplicateStep',
      severity,
      message: `Detected duplicate step: ${currentToolUse.name} performed ${isExact ? 'exactly' : 'approximately'} the same operation at steps ${previousIndex} and ${currentIndex}`,
      location: {
        stepRange: [previousIndex, currentIndex],
        toolUseId: currentToolUse.id,
      },
      suggestion: `Avoid performing the same operation repeatedly. If verification is needed, cache the result after the first execution`,
      evidence: {
        type: isExact ? 'strong' : 'medium',
        details: {
          toolName: currentToolUse.name,
          duplicateType: dup.type,
          isHighCost,
          inputSimilarity: dup.inputSimilarity,
          resultSimilarity: dup.resultSimilarity,
          timeDelta: dup.timeDelta,
        },
      },
      deduction,
    };
  }

  /**
   * Check whether it is a high-cost tool
   */
  private isHighCostTool(toolName: string): boolean {
    const highCostTools = ['Agent', 'Bash', 'WebFetch', 'WebSearch'];
    return highCostTools.includes(toolName);
  }
}
