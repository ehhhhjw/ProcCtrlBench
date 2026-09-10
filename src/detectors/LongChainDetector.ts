import { SessionData, MessageNode, ToolUseInfo } from '../../ClaudeCodeStructure/src/types';
import { IDetector, DetectionIssue, Severity, EvaluationConfig } from '../types/evaluation.types';
import { LongChainInfo } from '../types/metrics.types';
import { AstAnalyzer } from '../analyzers/AstAnalyzer';
import { ProjectAstLoader } from '../analyzers/ProjectAstLoader';
import { writePrewarn } from '../utils/Prewarn';
import { finalizeDetectorIssues } from './detector-calibration';

interface CodeFocus {
  index: number;
  message: MessageNode;
  files: Set<string>;
  neighborhood: Set<string>;
  symbols: Set<string>;
  hasWrite: boolean;
  hasRead: boolean;
  hasValidation: boolean;
}

/**
 * 长链检测器
 * 检测单一任务执行链过长,缺乏子任务拆分
 */
export class LongChainDetector implements IDetector {
  readonly name = 'LongChainDetector';
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

    // 获取所有步骤
    const messages = Array.from(this.sessionData.messages.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    const totalSteps = messages.length;

    // 识别子任务和检查点
    const explicitSubtasks = this.identifySubtasks(messages);
    const structuralSubtasks = this.identifyStructuralSubtasks(messages);
    const subtasks = this.mergeIndices(explicitSubtasks, structuralSubtasks);

    const explicitCheckpoints = this.identifyCheckpoints(messages);
    const structuralCheckpoints = this.identifyStructuralCheckpoints(messages);
    const checkpoints = this.mergeIndices(explicitCheckpoints, structuralCheckpoints);

    // 计算有效链长度
    const effectiveLength = totalSteps / (1 + subtasks.length + checkpoints.length);

    // 预警：接近简单阈值或有效链长度阈值
    if (subtasks.length === 0 && totalSteps === this.config.thresholds.longChain.simpleWarningLength - 1) {
      writePrewarn({
        metric: 'longChain',
        message: `执行链长度接近简单阈值: ${totalSteps}`,
        details: { totalSteps },
      });
    }
    if (effectiveLength >= this.config.thresholds.longChain.warningLength * 0.9 && effectiveLength < this.config.thresholds.longChain.warningLength) {
      writePrewarn({
        metric: 'longChain',
        message: `有效链长度接近阈值: ${effectiveLength.toFixed(1)}`,
        details: { effectiveLength, subtasks: subtasks.length, checkpoints: checkpoints.length },
      });
    }

    const info: LongChainInfo = {
      totalSteps,
      subtaskCount: subtasks.length,
      checkpointCount: checkpoints.length,
      effectiveLength,
    };

    // 判定阈值
    if (effectiveLength > this.config.thresholds.longChain.errorLength) {
      issues.push(this.createIssue(Severity.Error, info, {
        explicitSubtasks: explicitSubtasks.length,
        structuralSubtasks: structuralSubtasks.length,
        explicitCheckpoints: explicitCheckpoints.length,
        structuralCheckpoints: structuralCheckpoints.length,
      }));
    } else if (effectiveLength > this.config.thresholds.longChain.warningLength) {
      issues.push(this.createIssue(Severity.Warning, info, {
        explicitSubtasks: explicitSubtasks.length,
        structuralSubtasks: structuralSubtasks.length,
        explicitCheckpoints: explicitCheckpoints.length,
        structuralCheckpoints: structuralCheckpoints.length,
      }));
    }

    // 简单版本检查: 如果总步骤数很多但没有子任务
    if (subtasks.length === 0) {
      if (totalSteps > this.config.thresholds.longChain.simpleErrorLength) {
        issues.push(this.createSimpleIssue(Severity.Error, totalSteps));
      } else if (totalSteps > this.config.thresholds.longChain.simpleWarningLength) {
        issues.push(this.createSimpleIssue(Severity.Warning, totalSteps));
      }
    }

    return finalizeDetectorIssues(issues, this.config);
  }

  /**
   * 识别子任务
   */
  private identifySubtasks(messages: any[]): number[] {
    const subtaskIndices: number[] = [];

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];

      // 识别Agent调用(表示子任务)
      if (message.agentId && message.isSidechain) {
        subtaskIndices.push(i);
      }

      // 识别工具调用中的Agent
      for (const toolUse of message.toolUses || []) {
        if (toolUse.name === 'Agent') {
          subtaskIndices.push(i);
        }
      }
    }

    return subtaskIndices;
  }

  /**
   * 识别检查点
   */
  private identifyCheckpoints(messages: any[]): number[] {
    const checkpointIndices: number[] = [];

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];

      // 识别用户消息(表示检查点)
      if (message.type === 'user') {
        checkpointIndices.push(i);
      }

      // 识别测试/验证步骤
      for (const toolUse of message.toolUses || []) {
        if (toolUse.name === 'Bash') {
          const command = toolUse.input.command;

          // 测试命令
          if (command.includes('test') || command.includes('pytest') || command.includes('jest')) {
            checkpointIndices.push(i);
          }
        }
      }
    }

    return checkpointIndices;
  }

  /**
   * 识别隐式子任务：基于 AST/文件关系判断代码关注点已切换到新的模块簇。
   */
  private identifyStructuralSubtasks(messages: MessageNode[]): number[] {
    const focuses = this.buildCodeFocuses(messages);
    const subtaskIndices: number[] = [];
    let lastBoundary = -3;

    for (let i = 1; i < focuses.length; i++) {
      const previous = focuses[i - 1];
      const current = focuses[i];

      if (!this.hasMeaningfulFocus(previous) || !this.hasMeaningfulFocus(current)) {
        continue;
      }

      const overlap = this.calculateFocusOverlap(previous, current);
      const strongShift = overlap < 0.2;
      const transitionCue = previous.hasWrite || current.hasWrite || this.hasPlanningCue(previous.message) || this.hasPlanningCue(current.message);

      if (strongShift && transitionCue && current.index - lastBoundary >= 2) {
        subtaskIndices.push(current.index);
        lastBoundary = current.index;
      }
    }

    return subtaskIndices;
  }

  /**
   * 识别隐式检查点：修改某个代码簇后，对同一簇进行验证/回读。
   */
  private identifyStructuralCheckpoints(messages: MessageNode[]): number[] {
    const focuses = this.buildCodeFocuses(messages);
    const checkpointIndices: number[] = [];

    for (let i = 0; i < focuses.length; i++) {
      const current = focuses[i];
      if (!current.hasValidation && !(current.hasRead && !current.hasWrite)) {
        continue;
      }

      for (let j = i - 1; j >= 0 && i - j <= 4; j--) {
        const previous = focuses[j];
        if (!previous.hasWrite) {
          continue;
        }
        if (this.calculateFocusOverlap(previous, current) >= 0.25) {
          checkpointIndices.push(current.index);
          break;
        }
      }
    }

    return checkpointIndices;
  }

  /**
   * 创建问题
   */
  private createIssue(severity: Severity, info: LongChainInfo, details: Record<string, number>): DetectionIssue {
    const deduction = severity === Severity.Error ? 2.5 : 1.0;

    return {
      metric: 'longChain',
      severity,
      message: `检测到过长执行链: 总步骤 ${info.totalSteps}, 有效链长度 ${info.effectiveLength.toFixed(1)} (子任务: ${info.subtaskCount}, 检查点: ${info.checkpointCount})`,
      location: {
        stepRange: [0, info.totalSteps - 1],
      },
      suggestion: `建议将复杂任务拆分为多个子任务或设置中间检查点。可以使用Agent工具来创建子任务，或在关键步骤后添加验证`,
      evidence: {
        type: severity === Severity.Error ? 'strong' : 'medium',
        details: {
          ...info,
          ...details,
        },
      },
      deduction,
    };
  }

  /**
   * 创建简单问题
   */
  private createSimpleIssue(severity: Severity, totalSteps: number): DetectionIssue {
    const deduction = severity === Severity.Error ? 2.5 : 1.0;

    return {
      metric: 'longChain',
      severity,
      message: `检测到长执行链且无子任务拆分: 总步骤 ${totalSteps}, 未使用任何子任务`,
      location: {
        stepRange: [0, totalSteps - 1],
      },
      suggestion: `对于复杂任务，建议使用Agent工具创建子任务，将大任务分解为多个独立的小任务`,
      evidence: {
        type: severity === Severity.Error ? 'strong' : 'medium',
        details: {
          totalSteps,
          subtaskCount: 0,
        },
      },
      deduction,
    };
  }

  private buildCodeFocuses(messages: MessageNode[]): CodeFocus[] {
    const focuses: CodeFocus[] = [];

    for (let index = 0; index < messages.length; index++) {
      const message = messages[index];
      const files = new Set<string>();
      const neighborhood = new Set<string>();
      const symbols = new Set<string>();
      let hasWrite = false;
      let hasRead = false;
      let hasValidation = this.hasValidationCue(this.extractMessageText(message.content));

      for (const toolUse of message.toolUses || []) {
        if (toolUse.name === 'Edit' || toolUse.name === 'Write') {
          hasWrite = true;
        }
        if (toolUse.name === 'Read' || toolUse.name === 'Grep' || toolUse.name === 'Glob') {
          hasRead = true;
        }
        if (toolUse.name === 'Bash' && this.isValidationCommand(toolUse.input?.command || '')) {
          hasValidation = true;
        }

        const toolFiles = this.extractToolPaths(toolUse);
        for (const file of toolFiles) {
          files.add(file);
          if (this.projectAst) {
            for (const related of this.projectAst.getRelatedNeighborhood([file], 1, true)) {
              neighborhood.add(related);
            }
            for (const declared of this.projectAst.getDeclaredSymbols(file)) {
              symbols.add(declared);
            }
          } else {
            neighborhood.add(file);
          }
        }

        const result = this.sessionData.toolResults.get(toolUse.id);
        if (result && this.ast) {
          const extracted = this.ast.extractSymbols(this.extractResultContent(result.content), {
            filePath: toolUse.input?.file_path || toolUse.input?.path,
          });
          for (const symbol of [
            ...extracted.classes,
            ...extracted.functions,
            ...extracted.methods,
            ...(extracted.properties || []),
            ...(extracted.variables || []),
            ...(extracted.calls || []),
          ]) {
            if (symbol) {
              symbols.add(symbol);
            }
          }
        }
      }

      if (files.size === 0 && neighborhood.size === 0 && symbols.size === 0 && !hasValidation) {
        continue;
      }

      focuses.push({
        index,
        message,
        files,
        neighborhood,
        symbols,
        hasWrite,
        hasRead,
        hasValidation,
      });
    }

    return focuses;
  }

  private extractToolPaths(toolUse: ToolUseInfo): string[] {
    const paths = new Set<string>();
    for (const key of ['file_path', 'path']) {
      const value = toolUse.input?.[key];
      if (typeof value === 'string' && value.trim()) {
        paths.add(value);
      }
    }
    if (toolUse.name === 'Bash') {
      const command = String(toolUse.input?.command || '');
      for (const match of command.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g) || []) {
        paths.add(match);
      }
    }
    return Array.from(paths);
  }

  private calculateFocusOverlap(previous: CodeFocus, current: CodeFocus): number {
    const previousFiles = previous.neighborhood.size > 0 ? previous.neighborhood : previous.files;
    const currentFiles = current.neighborhood.size > 0 ? current.neighborhood : current.files;
    const fileOverlap = previousFiles.size > 0 || currentFiles.size > 0
      ? this.calculateJaccard(previousFiles, currentFiles)
      : 0;
    const symbolOverlap = previous.symbols.size > 0 || current.symbols.size > 0
      ? this.calculateJaccard(previous.symbols, current.symbols)
      : 0;
    return Math.max(fileOverlap, symbolOverlap);
  }

  private calculateJaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) {
      return 1;
    }
    const union = new Set<string>([...a, ...b]);
    let intersection = 0;
    for (const item of a) {
      if (b.has(item)) {
        intersection += 1;
      }
    }
    return union.size > 0 ? intersection / union.size : 0;
  }

  private hasMeaningfulFocus(focus: CodeFocus): boolean {
    return focus.files.size > 0 || focus.neighborhood.size >= 2 || focus.symbols.size >= 3;
  }

  private hasPlanningCue(message: MessageNode): boolean {
    return this.hasPlanningText(this.extractMessageText(message.content));
  }

  private hasPlanningText(text: string): boolean {
    if (!text) {
      return false;
    }
    const normalized = text.toLowerCase();
    return ['plan', '步骤', '阶段', '接下来', '然后', 'first', 'next'].some((token) => normalized.includes(token));
  }

  private hasValidationCue(text: string): boolean {
    if (!text) {
      return false;
    }
    const normalized = text.toLowerCase();
    return ['验证', '检查', '确认', 'verify', 'check', 'test'].some((token) => normalized.includes(token));
  }

  private isValidationCommand(command: string): boolean {
    const normalized = String(command || '').toLowerCase();
    return ['test', 'pytest', 'jest', 'verify', 'check', 'cargo test', 'npm test'].some((token) => normalized.includes(token));
  }

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

  private extractResultContent(content: any): string {
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

  private mergeIndices(...groups: number[][]): number[] {
    return Array.from(new Set(groups.flat())).sort((a, b) => a - b);
  }
}
