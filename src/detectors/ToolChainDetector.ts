import { SessionData, ToolUseInfo } from '../../ClaudeCodeStructure/src/types';
import { IDetector, DetectionIssue, Severity, EvaluationConfig } from '../types/evaluation.types';
import { ToolChainInfo, CyclicChainInfo } from '../types/metrics.types';
import { AstAnalyzer } from '../analyzers/AstAnalyzer';
import { ProjectAstLoader } from '../analyzers/ProjectAstLoader';
import { CodeContextAnalyzer } from '../analyzers/CodeContextAnalyzer';
import { writePrewarn } from '../utils/Prewarn';
import { finalizeDetectorIssues } from './detector-calibration';

/**
 * 工具调用链检测器
 * 检测两种问题:
 * 1. Repetitive Chain: 同一工具连续调用过多
 * 2. Cyclic Chain: 工具调用出现循环
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

    // 检测重复调用链
    const repetitiveIssues = await this.detectRepetitiveChain();
    issues.push(...repetitiveIssues);

    // 检测循环调用链
    const cyclicIssues = await this.detectCyclicChain();
    issues.push(...cyclicIssues);

    return issues;
  }

  /**
   * 检测重复调用链
   */
  private async detectRepetitiveChain(): Promise<DetectionIssue[]> {
    const issues: DetectionIssue[] = [];

    // 获取按时间排序的所有工具调用
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
        // 检查前一个链
        // 临近阈值时写预警（帮助模型自调）
        if (consecutiveCount === this.config.thresholds.toolChain.repetitiveWarningCount - 1) {
          writePrewarn({
            metric: 'toolCallChain',
            message: `接近重复调用阈值: ${currentTool} 连续 ${consecutiveCount} 次`,
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
              message: `检测到重复工具调用链: ${currentTool} 连续调用 ${consecutiveCount} 次`,
              location: {
                stepRange: [chainStart, i - 1],
              },
              suggestion: `考虑使用更高效的方式。例如，如果是连续Read操作，可以先用Grep搜索，然后只读取相关文件`,
              evidence: {
                type: 'strong',
                details: {
                  toolName: currentTool,
                  consecutiveCount,
                  inputs: chainInputs.slice(0, 3), // 只保留前3个示例
                },
              },
              deduction,
            });
          }
        }

        // 重置计数
        currentTool = toolUse.name;
        consecutiveCount = 1;
        chainStart = i;
        chainInputs = [toolUse.input];
        chainToolUses = [toolUse];
      }
    }

    // 检查最后一个链
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
          message: `检测到重复工具调用链: ${currentTool} 连续调用 ${consecutiveCount} 次`,
          location: {
            stepRange: [chainStart, toolUses.length - 1],
          },
          suggestion: `考虑使用更高效的方式`,
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
   * 检查重复调用豁免条件
   */
  private checkRepetitiveExemption(toolName: string, toolUses: ToolUseInfo[]): boolean {
    // 豁免条件1: 输入对象显著不同
    if (this.hasSignificantlyDifferentInputs(toolUses.map(toolUse => toolUse.input))) {
      return true;
    }

    // 豁免条件2: 属于合理批处理
    if (this.isReasonableBatchProcessing(toolName, toolUses)) {
      return true;
    }

    // 豁免条件3: 明确搜索阶段且范围收敛
    if (this.isConvergingSearch(toolName, toolUses)) {
      return true;
    }

    return false;
  }

  /**
   * 检查输入是否显著不同
   */
  private hasSignificantlyDifferentInputs(inputs: any[]): boolean {
    if (inputs.length <= 1) return false;

    // 计算输入的多样性
    const uniqueInputs = new Set(inputs.map(input => JSON.stringify(input)));
    const diversityRatio = uniqueInputs.size / inputs.length;

    // 如果超过80%的输入是不同的,认为是合理的
    return diversityRatio > 0.8;
  }

  /**
   * 检查是否是合理的批处理
   */
  private isReasonableBatchProcessing(toolName: string, toolUses: ToolUseInfo[]): boolean {
    // 某些工具天然支持批处理
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

    // 如果处于同一代码邻域内的渐进式批处理，也视为合理。
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
   * 检查是否是收敛的搜索
   */
  private isConvergingSearch(toolName: string, toolUses: ToolUseInfo[]): boolean {
    // 只对搜索相关工具检查
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
   * 检测循环调用链
   */
  private async detectCyclicChain(): Promise<DetectionIssue[]> {
    const issues: DetectionIssue[] = [];

    // 获取按时间排序的所有工具调用
    const toolUses = Array.from(this.sessionData.toolUses.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    const toolNames = toolUses.map(t => t.name);

    // 检测A→B→A或A→B→C→A模式
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

        // 临近循环阈值时预警
        if (cycle.cycleCount === this.config.thresholds.toolChain.cyclicWarningCount - 1) {
          try {
            const { writePrewarn } = require('../utils/Prewarn');
            writePrewarn({
              metric: 'toolCallChain',
              message: `接近循环调用阈值: ${cycle.pattern.join('→')} 重复 ${cycle.cycleCount} 轮`,
              details: { pattern: cycle.pattern, count: cycle.cycleCount },
            });
          } catch {}
        }

        issues.push({
          metric: 'toolCallChain',
          severity,
          message: `检测到循环工具调用: ${cycle.pattern.join('→')} 重复 ${cycle.cycleCount} 轮`,
          location: {
            stepRange: [cycle.startStep, cycle.endStep],
          },
          suggestion: `工具调用出现循环可能表示任务陷入死循环或策略不当，建议重新设计执行策略`,
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
   * 查找循环模式
   */
  private findCycles(toolNames: string[]): CyclicChainInfo[] {
    const cycles: CyclicChainInfo[] = [];

    // 检测2-4个工具的循环模式
    for (let patternLength = 2; patternLength <= 4; patternLength++) {
      const detectedCycles = this.detectCyclePattern(toolNames, patternLength);
      cycles.push(...detectedCycles);
    }

    return cycles;
  }

  /**
   * 检测指定长度的循环模式
   */
  private detectCyclePattern(toolNames: string[], patternLength: number): CyclicChainInfo[] {
    const cycles: CyclicChainInfo[] = [];

    for (let i = 0; i <= toolNames.length - patternLength * 2; i++) {
      const pattern = toolNames.slice(i, i + patternLength);
      let cycleCount = 1;
      let currentPos = i + patternLength;

      // 检查后续是否重复该模式
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

        // 跳过已检测的循环
        i = currentPos - 1;
      }
    }

    return cycles;
  }

  /**
   * 比较两个数组是否相等
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
