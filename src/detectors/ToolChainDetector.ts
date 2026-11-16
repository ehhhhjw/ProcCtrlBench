import { SessionData, ToolUseInfo } from '../../ClaudeCodeStructure/src/types';
import { IDetector, DetectionIssue, Severity, EvaluationConfig } from '../types/evaluation.types';
import { ToolChainInfo, CyclicChainInfo } from '../types/metrics.types';
import { AstAnalyzer } from '../analyzers/AstAnalyzer';
import { ProjectAstLoader } from '../analyzers/ProjectAstLoader';
import { CodeContextAnalyzer } from '../analyzers/CodeContextAnalyzer';
import { writePrewarn } from '../utils/Prewarn';
import { finalizeDetectorIssues } from './detector-calibration';

/**
 * Tool call chain detector
 * Detects two kinds of problems:
 * 1. Repetitive Chain: the same tool is called too many times in a row
 * 2. Cyclic Chain: tool calls form a cycle
 */
export class ToolChainDetector implements IDetector {
  readonly name = 'ToolChainDetector';
  private sessionData: SessionData;
  private config: EvaluationConfig;
  private ast?: AstAnalyzer;
  private projectAst?: ProjectAstLoader;
  private codeContext: CodeContextAnalyzer;

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
    this.codeContext = new CodeContextAnalyzer(this.sessionData, this.ast, this.projectAst);
  }

  async detect(): Promise<DetectionIssue[]> {
    const issues: DetectionIssue[] = [];

    // Detect repetitive call chains
    const repetitiveIssues = await this.detectRepetitiveChain();
    issues.push(...repetitiveIssues);

    // Detect cyclic call chains
    const cyclicIssues = await this.detectCyclicChain();
    issues.push(...cyclicIssues);

    return issues;
  }

  /**
   * Detect repetitive call chains
   */
  private async detectRepetitiveChain(): Promise<DetectionIssue[]> {
    const issues: DetectionIssue[] = [];

    // Get all tool calls sorted by time
    const toolUses = Array.from(this.sessionData.toolUses.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    let currentTool = '';
    let consecutiveCount = 0;
    let chainStart = 0;
    let chainInputs: any[] = [];
    let chainToolUses: ToolUseInfo[] = [];

    for (let i = 0; i < toolUses.length; i++) {
      const toolUse = toolUses[i];

      if (toolUse.name === currentTool) {
        consecutiveCount++;
        chainInputs.push(toolUse.input);
        chainToolUses.push(toolUse);
      } else {
        // Check the previous chain
        // Write a prewarn when nearing the threshold (helps the model self-correct)
        if (consecutiveCount === this.config.thresholds.toolChain.repetitiveWarningCount - 1) {
          writePrewarn({
            metric: 'toolCallChain',
            message: `near duplicate-call threshold: ${currentTool} ${consecutiveCount} times in a row`,
            details: { tool: currentTool, count: consecutiveCount },
          });
        }
        if (consecutiveCount >= this.config.thresholds.toolChain.repetitiveWarningCount) {
          const exempt = this.checkRepetitiveExemption(currentTool, chainToolUses);

          if (!exempt) {
            const severity = consecutiveCount >= this.config.thresholds.toolChain.repetitiveErrorCount
              ? Severity.Error
              : Severity.Warning;

            const deduction = severity === Severity.Error ? 2.5 : 1.0;

            issues.push({
              metric: 'toolCallChain',
              severity,
              message: `Detected duplicate tool call chain: ${currentTool} called ${consecutiveCount} times in a row`,
              location: {
                stepRange: [chainStart, i - 1],
              },
              suggestion: `Consider a more efficient approach. For example, for consecutive Read operations, search with Grep first and then read only the relevant files`,
              evidence: {
                type: 'strong',
                details: {
                  toolName: currentTool,
                  consecutiveCount,
                  inputs: chainInputs.slice(0, 3), // Keep only the first 3 examples
                },
              },
              deduction,
            });
          }
        }

        // Reset the counter
        currentTool = toolUse.name;
        consecutiveCount = 1;
        chainStart = i;
        chainInputs = [toolUse.input];
        chainToolUses = [toolUse];
      }
    }

    // Check the last chain
    if (consecutiveCount >= this.config.thresholds.toolChain.repetitiveWarningCount) {
      const exempt = this.checkRepetitiveExemption(currentTool, chainToolUses);

      if (!exempt) {
        const severity = consecutiveCount >= this.config.thresholds.toolChain.repetitiveErrorCount
          ? Severity.Error
          : Severity.Warning;

        const deduction = severity === Severity.Error ? 2.5 : 1.0;

        issues.push({
          metric: 'toolCallChain',
          severity,
          message: `Detected duplicate tool call chain: ${currentTool} called ${consecutiveCount} times in a row`,
          location: {
            stepRange: [chainStart, toolUses.length - 1],
          },
          suggestion: `Consider a more efficient approach`,
          evidence: {
            type: 'strong',
            details: {
              toolName: currentTool,
              consecutiveCount,
              inputs: chainInputs.slice(0, 3),
            },
          },
          deduction,
        });
      }
    }

    return finalizeDetectorIssues(issues, this.config);
  }

  /**
   * Check the exemption conditions for duplicate calls
   */
  private checkRepetitiveExemption(toolName: string, toolUses: ToolUseInfo[]): boolean {
    // Exemption 1: the input objects are significantly different
    if (this.hasSignificantlyDifferentInputs(toolUses.map(toolUse => toolUse.input))) {
      return true;
    }

    // Exemption 2: it qualifies as reasonable batch processing
    if (this.isReasonableBatchProcessing(toolName, toolUses)) {
      return true;
    }

    // Exemption 3: it is clearly a search phase with a converging scope
    if (this.isConvergingSearch(toolName, toolUses)) {
      return true;
    }

    return false;
  }

  /**
   * Check whether the inputs are significantly different
   */
  private hasSignificantlyDifferentInputs(inputs: any[]): boolean {
    if (inputs.length <= 1) return false;

    // Compute the diversity of the inputs
    const uniqueInputs = new Set(inputs.map(input => JSON.stringify(input)));
    const diversityRatio = uniqueInputs.size / inputs.length;

    // If more than 80% of the inputs are different, treat it as reasonable
    return diversityRatio > 0.8;
  }

  /**
   * Check whether it is reasonable batch processing
   */
  private isReasonableBatchProcessing(toolName: string, toolUses: ToolUseInfo[]): boolean {
    // Some tools naturally support batch processing
    const batchableTools = ['Write', 'Edit', 'Read'];

    if (!batchableTools.includes(toolName)) {
      return false;
    }

    const filePaths = toolUses
      .flatMap((toolUse) => this.codeContext.extractToolPaths(toolUse));

    if (filePaths.length === 0) return false;

    const uniqueFiles = new Set(filePaths);
    if (uniqueFiles.size === filePaths.length) {
      return true;
    }

    // Incremental batch processing within the same code neighborhood is also considered reasonable.
    if (!this.projectAst) {
      return false;
    }
    const neighborhoods = toolUses.map((toolUse) => this.codeContext.getToolFootprint(toolUse));
    for (let i = 1; i < neighborhoods.length; i++) {
      if (!this.codeContext.hasMeaningfulOverlap(neighborhoods[i - 1], neighborhoods[i], 0.2)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Check whether it is a converging search
   */
  private isConvergingSearch(toolName: string, toolUses: ToolUseInfo[]): boolean {
    // Only check search-related tools
    const searchTools = ['Grep', 'Glob', 'Read'];

    if (!searchTools.includes(toolName)) {
      return false;
    }

    const footprints = toolUses.map((toolUse) => this.codeContext.getToolFootprint(toolUse));
    const hasContextContinuity = footprints.every((footprint, index) => {
      if (index === 0) {
        return true;
      }
      return this.codeContext.hasMeaningfulOverlap(footprints[index - 1], footprint, 0.15);
    });
    if (!hasContextContinuity) {
      return false;
    }

    const patternLengths = toolUses.map((toolUse) => String(toolUse.input?.pattern || '').length);
    const patternsMonotonic = patternLengths.every((length, index) => index === 0 || length >= patternLengths[index - 1]);
    const uniqueDirectFiles = new Set(
      toolUses.flatMap((toolUse) => Array.from(this.codeContext.getToolFootprint(toolUse).directFiles))
    );

    return patternsMonotonic || uniqueDirectFiles.size >= Math.ceil(toolUses.length * 0.6);
  }

  /**
   * Detect cyclic call chains
   */
  private async detectCyclicChain(): Promise<DetectionIssue[]> {
    const issues: DetectionIssue[] = [];

    // Get all tool calls sorted by time
    const toolUses = Array.from(this.sessionData.toolUses.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    const toolNames = toolUses.map(t => t.name);

    // Detect A→B→A or A→B→C→A patterns
    const cycles = this.findCycles(toolNames);

    for (const cycle of cycles) {
      if (this.isCycleExempt(toolUses, cycle)) {
        continue;
      }
      if (cycle.cycleCount >= this.config.thresholds.toolChain.cyclicWarningCount) {
        const severity = cycle.cycleCount >= this.config.thresholds.toolChain.cyclicErrorCount
          ? Severity.Error
          : Severity.Warning;

        const deduction = severity === Severity.Error ? 2.5 : 1.0;

        // Prewarn when nearing the cyclic threshold
        if (cycle.cycleCount === this.config.thresholds.toolChain.cyclicWarningCount - 1) {
          try {
            const { writePrewarn } = require('../utils/Prewarn');
            writePrewarn({
              metric: 'toolCallChain',
              message: `near cyclic-call threshold: ${cycle.pattern.join('→')} repeated for ${cycle.cycleCount} rounds`,
              details: { pattern: cycle.pattern, count: cycle.cycleCount },
            });
          } catch {}
        }

        issues.push({
          metric: 'toolCallChain',
          severity,
          message: `Detected cyclic tool calls: ${cycle.pattern.join('→')} repeated for ${cycle.cycleCount} rounds`,
          location: {
            stepRange: [cycle.startStep, cycle.endStep],
          },
          suggestion: `A cycle in tool calls may indicate that the task is stuck in an infinite loop or that the strategy is inappropriate; consider redesigning the execution strategy`,
          evidence: {
            type: 'strong',
            details: {
              pattern: cycle.pattern,
              cycleCount: cycle.cycleCount,
            },
          },
          deduction,
        });
      }
    }

    return finalizeDetectorIssues(issues, this.config);
  }

  /**
   * Find cyclic patterns
   */
  private findCycles(toolNames: string[]): CyclicChainInfo[] {
    const cycles: CyclicChainInfo[] = [];

    // Detect cyclic patterns of 2-4 tools
    for (let patternLength = 2; patternLength <= 4; patternLength++) {
      const detectedCycles = this.detectCyclePattern(toolNames, patternLength);
      cycles.push(...detectedCycles);
    }

    return cycles;
  }

  /**
   * Detect cyclic patterns of a given length
   */
  private detectCyclePattern(toolNames: string[], patternLength: number): CyclicChainInfo[] {
    const cycles: CyclicChainInfo[] = [];

    for (let i = 0; i <= toolNames.length - patternLength * 2; i++) {
      const pattern = toolNames.slice(i, i + patternLength);
      let cycleCount = 1;
      let currentPos = i + patternLength;

      // Check whether the pattern repeats afterwards
      while (currentPos + patternLength <= toolNames.length) {
        const nextSegment = toolNames.slice(currentPos, currentPos + patternLength);

        if (this.arraysEqual(pattern, nextSegment)) {
          cycleCount++;
          currentPos += patternLength;
        } else {
          break;
        }
      }

      if (cycleCount >= 2) {
        cycles.push({
          pattern,
          cycleCount,
          startStep: i,
          endStep: currentPos - 1,
        });

        // Skip the cycle that has already been detected
        i = currentPos - 1;
      }
    }

    return cycles;
  }

  /**
   * Compare whether two arrays are equal
   */
  private arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((val, idx) => val === b[idx]);
  }

  private isCycleExempt(toolUses: ToolUseInfo[], cycle: CyclicChainInfo): boolean {
    const cycleTools = toolUses.slice(cycle.startStep, cycle.endStep + 1);
    if (cycleTools.length === 0) {
      return false;
    }

    const directFiles = new Set<string>();
    for (const toolUse of cycleTools) {
      const footprint = this.codeContext.getToolFootprint(toolUse);
      for (const file of footprint.directFiles) {
        directFiles.add(file);
      }
    }

    if (directFiles.size >= cycle.pattern.length + 1) {
      return true;
    }

    return false;
  }
}
