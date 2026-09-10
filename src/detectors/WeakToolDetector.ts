import { SessionData, ToolUseInfo } from '../../ClaudeCodeStructure/src/types';
import { IDetector, DetectionIssue, Severity, EvaluationConfig } from '../types/evaluation.types';
import { WeakToolInfo } from '../types/metrics.types';
import { AstAnalyzer } from '../analyzers/AstAnalyzer';
import { ProjectAstLoader } from '../analyzers/ProjectAstLoader';
import { CodeContextAnalyzer } from '../analyzers/CodeContextAnalyzer';
import { writePrewarn } from '../utils/Prewarn';
import { finalizeDetectorIssues } from './detector-calibration';

/**
 * Weak tool detector
 * Detects tools with a low invocation rate in applicable scenarios
 */
export class WeakToolDetector implements IDetector {
  readonly name = 'WeakToolDetector';
  private sessionData: SessionData;
  private config: EvaluationConfig;
  private ast?: AstAnalyzer;
  private projectAst?: ProjectAstLoader;
  private codeContext: CodeContextAnalyzer;

  // Tool suitability mapping: defines the task types each tool is applicable to
  private readonly toolSuitability: Map<string, string[]> = new Map([
    ['Glob', ['file_search']],
    ['Grep', ['file_search', 'code_search']],
    ['Read', ['file_read', 'code_search']],
    ['Edit', ['file_modify']],
    ['Write', ['file_modify']],
    ['Bash', ['command_execution']],
    ['Agent', ['subtask_delegation']],
    ['WebSearch', ['web_search']],
    ['WebFetch', ['web_fetch', 'web_search']],
  ]);

  // Alternative relationships between tools
  private readonly toolAlternatives: Map<string, string[]> = new Map([
    ['Grep', ['Read', 'Bash']],
    ['Glob', ['Bash', 'Read']],
    ['Read', ['Bash']],
    ['Edit', ['Write', 'Bash']],
    ['WebSearch', ['WebFetch', 'Bash']],
  ]);

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

    // Collect tool usage statistics
    const toolUsage = this.collectToolUsage();

    // Infer task types
    const taskTypes = this.inferTaskTypes();

    // For each tool, check its invocation rate in applicable scenarios
    for (const [tool, suitableTaskTypes] of this.toolSuitability.entries()) {
      // Count the tasks this tool is applicable to
      const suitableTaskCount = suitableTaskTypes.reduce(
        (count, taskType) => count + (taskTypes.get(taskType) || 0),
        0
      );

      if (suitableTaskCount >= 3) {
        // If there are enough applicable tasks
        const actualCallCount = toolUsage.get(tool) || 0;
        const callRate = actualCallCount / suitableTaskCount;

        // Prewarn when near threshold, hinting at improved tool discoverability
        if (callRate < 0.35 && callRate >= 0.3) {
          writePrewarn({
            metric: 'weakTool',
            message: `Tool invocation rate near threshold: ${tool} ${(callRate * 100).toFixed(0)}%`,
            details: { suitableTaskCount, actualCallCount },
          });
        }
        if (callRate < 0.3) {
          // Invocation rate below 30%
          const severity = callRate < 0.15 ? Severity.Error : Severity.Warning;
          const deduction = severity === Severity.Error ? 2.0 : 1.0;

          // Check whether alternative tools are used heavily instead
          const alternatives = this.checkAlternativeUsage(tool, toolUsage);

          issues.push({
            metric: 'weakTool',
            severity,
            message: `Weak tool detected: ${tool} in ${suitableTaskCount} applicable tasks was invoked only ${actualCallCount} times (${(callRate * 100).toFixed(0)}%)`,
            location: {},
            suggestion: alternatives.length > 0
              ? `The ${tool} tool has low discoverability and may be replaced by ${alternatives.map(a => a.name).join(', ')}. Consider improving the tool description or prompt`
              : `The ${tool} tool has low discoverability. Consider improving the tool description, adding usage examples, or proactively prompting at the right moment`,
            evidence: {
              type: severity === Severity.Error ? 'strong' : 'medium',
              details: {
                toolName: tool,
                callRate,
                suitableTaskCount,
                actualCallCount,
                alternativeTools: alternatives,
              },
            },
            deduction,
          });
        }
      }
    }

    return finalizeDetectorIssues(issues, this.config);
  }

  /**
   * Collects tool usage statistics
   */
  private collectToolUsage(): Map<string, number> {
    const usage = new Map<string, number>();

    for (const toolUse of this.sessionData.toolUses.values()) {
      usage.set(toolUse.name, (usage.get(toolUse.name) || 0) + 1);
    }

    return usage;
  }

  /**
   * Infers task types
   */
  private inferTaskTypes(): Map<string, number> {
    const taskTypes = new Map<string, number>();

    // Analyze tool invocation patterns to infer tasks
    for (const toolUse of Array.from(this.sessionData.toolUses.values()).sort((a, b) => a.timestamp - b.timestamp)) {
      const inferredTasks = this.inferTaskFromToolUse(toolUse);

      for (const task of inferredTasks) {
        taskTypes.set(task, (taskTypes.get(task) || 0) + 1);
      }
    }

    return taskTypes;
  }

  /**
   * Infers the task type from a tool invocation
   */
  private inferTaskFromToolUse(toolUse: ToolUseInfo): string[] {
    const tasks = new Set<string>();
    const footprint = this.codeContext.getToolFootprint(toolUse);

    switch (toolUse.name) {
      case 'Glob':
      case 'Grep':
        tasks.add('file_search');
        tasks.add('code_search');
        break;

      case 'Read':
        tasks.add('file_read');
        tasks.add('code_search');
        break;

      case 'Edit':
      case 'Write':
        tasks.add('file_modify');
        break;

      case 'Bash':
        // Infer from the command content
        const command = toolUse.input.command || '';
        if (command.includes('find') || command.includes('ls')) {
          tasks.add('file_search');
        }
        if (command.includes('grep')) {
          tasks.add('code_search');
        }
        if (command.includes('cat') || command.includes('head') || command.includes('tail')) {
          tasks.add('file_read');
        }
        if (command.includes('echo') || command.includes('sed') || command.includes('awk')) {
          tasks.add('file_modify');
        }
        tasks.add('command_execution');
        break;

      case 'Agent':
        tasks.add('subtask_delegation');
        break;

      case 'WebSearch':
        tasks.add('web_search');
        break;

      case 'WebFetch':
        tasks.add('web_fetch');
        tasks.add('web_search');
        break;
    }

    if (footprint.directFiles.size > 0) {
      tasks.add('file_read');
    }
    if (
      footprint.strongRelatedFiles.size + footprint.weakRelatedFiles.size >= 2 ||
      footprint.directFiles.size >= 2
    ) {
      tasks.add('file_search');
    }
    if (footprint.symbols.size >= 3) {
      tasks.add('code_search');
    }
    if (
      (toolUse.name === 'Edit' || toolUse.name === 'Write') &&
      footprint.directFiles.size + footprint.strongRelatedFiles.size >= 2
    ) {
      tasks.add('subtask_delegation');
    }

    return Array.from(tasks);
  }

  /**
   * Checks the usage of alternative tools
   */
  private checkAlternativeUsage(
    tool: string,
    toolUsage: Map<string, number>
  ): Array<{ name: string; callRate: number }> {
    const alternatives: Array<{ name: string; callRate: number }> = [];

    const alternativeNames = this.toolAlternatives.get(tool) || [];
    const toolCallCount = toolUsage.get(tool) || 0;

    for (const altName of alternativeNames) {
      const altCallCount = toolUsage.get(altName) || 0;

      // If the alternative tool is invoked more than twice as often as the original tool
      if (altCallCount > toolCallCount * 2) {
        alternatives.push({
          name: altName,
          callRate: altCallCount / (toolCallCount + altCallCount),
        });
      }
    }

    return alternatives;
  }
}
