import { SessionData, ToolUseInfo } from '../../ClaudeCodeStructure/src/types';
import { IDetector, DetectionIssue, Severity, EvaluationConfig } from '../types/evaluation.types';
import { WeakToolInfo } from '../types/metrics.types';
import { AstAnalyzer } from '../analyzers/AstAnalyzer';
import { ProjectAstLoader } from '../analyzers/ProjectAstLoader';
import { CodeContextAnalyzer } from '../analyzers/CodeContextAnalyzer';
import { writePrewarn } from '../utils/Prewarn';
import { finalizeDetectorIssues } from './detector-calibration';

/**
 * 弱工具检测器
 * 检测在适用场景调用率偏低的工具
 */
export class WeakToolDetector implements IDetector {
  readonly name = 'WeakToolDetector';
  private sessionData: SessionData;
  private config: EvaluationConfig;
  private ast?: AstAnalyzer;
  private projectAst?: ProjectAstLoader;
  private codeContext: CodeContextAnalyzer;

  // 工具适用性映射：定义每个工具适用的任务类型
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

  // 工具的替代关系
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

    // 收集工具使用统计
    const toolUsage = this.collectToolUsage();

    // 推断任务类型
    const taskTypes = this.inferTaskTypes();

    // 对每个工具检查其在适用场景的调用率
    for (const [tool, suitableTaskTypes] of this.toolSuitability.entries()) {
      // 计算该工具适用的任务数量
      const suitableTaskCount = suitableTaskTypes.reduce(
        (count, taskType) => count + (taskTypes.get(taskType) || 0),
        0
      );

      if (suitableTaskCount >= 3) {
        // 如果有足够多的适用任务
        const actualCallCount = toolUsage.get(tool) || 0;
        const callRate = actualCallCount / suitableTaskCount;

        // 接近阈值的预警，提示改进工具可发现性
        if (callRate < 0.35 && callRate >= 0.3) {
          writePrewarn({
            metric: 'weakTool',
            message: `工具调用率接近阈值: ${tool} ${(callRate * 100).toFixed(0)}%`,
            details: { suitableTaskCount, actualCallCount },
          });
        }
        if (callRate < 0.3) {
          // 调用率低于30%
          const severity = callRate < 0.15 ? Severity.Error : Severity.Warning;
          const deduction = severity === Severity.Error ? 2.0 : 1.0;

          // 检查是否被替代工具大量使用
          const alternatives = this.checkAlternativeUsage(tool, toolUsage);

          issues.push({
            metric: 'weakTool',
            severity,
            message: `检测到弱工具: ${tool} 在 ${suitableTaskCount} 个适用任务中仅被调用 ${actualCallCount} 次 (${(callRate * 100).toFixed(0)}%)`,
            location: {},
            suggestion: alternatives.length > 0
              ? `${tool}工具可发现性低，可能被${alternatives.map(a => a.name).join(', ')}替代。考虑改进工具描述或提示`
              : `${tool}工具可发现性低。考虑改进工具描述、增加使用示例、或在适当时机主动提示`,
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
   * 收集工具使用统计
   */
  private collectToolUsage(): Map<string, number> {
    const usage = new Map<string, number>();

    for (const toolUse of this.sessionData.toolUses.values()) {
      usage.set(toolUse.name, (usage.get(toolUse.name) || 0) + 1);
    }

    return usage;
  }

  /**
   * 推断任务类型
   */
  private inferTaskTypes(): Map<string, number> {
    const taskTypes = new Map<string, number>();

    // 分析工具调用模式来推断任务
    for (const toolUse of Array.from(this.sessionData.toolUses.values()).sort((a, b) => a.timestamp - b.timestamp)) {
      const inferredTasks = this.inferTaskFromToolUse(toolUse);

      for (const task of inferredTasks) {
        taskTypes.set(task, (taskTypes.get(task) || 0) + 1);
      }
    }

    return taskTypes;
  }

  /**
   * 从工具调用推断���务类型
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
        // 根据命令内容推断
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
   * 检查替代工具的使用情况
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

      // 如果替代工具的调用次数是原工具的2倍以上
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
