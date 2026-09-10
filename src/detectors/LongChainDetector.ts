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
 * Long chain detector
 * Detects a single task whose execution chain is too long and lacks subtask decomposition
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

    // Get all steps
    const messages = Array.from(this.sessionData.messages.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    const totalSteps = messages.length;

    // Identify subtasks and checkpoints
    const explicitSubtasks = this.identifySubtasks(messages);
    const structuralSubtasks = this.identifyStructuralSubtasks(messages);
    const subtasks = this.mergeIndices(explicitSubtasks, structuralSubtasks);

    const explicitCheckpoints = this.identifyCheckpoints(messages);
    const structuralCheckpoints = this.identifyStructuralCheckpoints(messages);
    const checkpoints = this.mergeIndices(explicitCheckpoints, structuralCheckpoints);

    // Calculate the effective chain length
    const effectiveLength = totalSteps / (1 + subtasks.length + checkpoints.length);

    // Prewarn: near the simple threshold or the effective chain length threshold
    if (subtasks.length === 0 && totalSteps === this.config.thresholds.longChain.simpleWarningLength - 1) {
      writePrewarn({
        metric: 'longChain',
        message: `execution chain length near simple threshold: ${totalSteps}`,
        details: { totalSteps },
      });
    }
    if (effectiveLength >= this.config.thresholds.longChain.warningLength * 0.9 && effectiveLength < this.config.thresholds.longChain.warningLength) {
      writePrewarn({
        metric: 'longChain',
        message: `effective chain length near threshold: ${effectiveLength.toFixed(1)}`,
        details: { effectiveLength, subtasks: subtasks.length, checkpoints: checkpoints.length },
      });
    }

    const info: LongChainInfo = {
      totalSteps,
      subtaskCount: subtasks.length,
      checkpointCount: checkpoints.length,
      effectiveLength,
    };

    // Threshold determination
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

    // Simple check: many total steps but no subtasks
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
   * Identify subtasks
   */
  private identifySubtasks(messages: any[]): number[] {
    const subtaskIndices: number[] = [];

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];

      // Identify Agent invocations (indicating a subtask)
      if (message.agentId && message.isSidechain) {
        subtaskIndices.push(i);
      }

      // Identify Agent among the tool invocations
      for (const toolUse of message.toolUses || []) {
        if (toolUse.name === 'Agent') {
          subtaskIndices.push(i);
        }
      }
    }

    return subtaskIndices;
  }

  /**
   * Identify checkpoints
   */
  private identifyCheckpoints(messages: any[]): number[] {
    const checkpointIndices: number[] = [];

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];

      // Identify user messages (indicating a checkpoint)
      if (message.type === 'user') {
        checkpointIndices.push(i);
      }

      // Identify test/validation steps
      for (const toolUse of message.toolUses || []) {
        if (toolUse.name === 'Bash') {
          const command = toolUse.input.command;

          // Test commands
          if (command.includes('test') || command.includes('pytest') || command.includes('jest')) {
            checkpointIndices.push(i);
          }
        }
      }
    }

    return checkpointIndices;
  }

  /**
   * Identify implicit subtasks: use AST/file relationships to determine that the code focus has shifted to a new module cluster.
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
   * Identify implicit checkpoints: after modifying a code cluster, the same cluster is validated or read back.
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
   * Create an issue
   */
  private createIssue(severity: Severity, info: LongChainInfo, details: Record<string, number>): DetectionIssue {
    const deduction = severity === Severity.Error ? 2.5 : 1.0;

    return {
      metric: 'longChain',
      severity,
      message: `Detected overly long execution chain: total steps ${info.totalSteps}, effective chain length ${info.effectiveLength.toFixed(1)} (subtasks: ${info.subtaskCount}, checkpoints: ${info.checkpointCount})`,
      location: {
        stepRange: [0, info.totalSteps - 1],
      },
      suggestion: `Consider splitting a complex task into multiple subtasks or setting intermediate checkpoints. You can use the Agent tool to create subtasks, or add validation after key steps`,
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
   * Create a simple issue
   */
  private createSimpleIssue(severity: Severity, totalSteps: number): DetectionIssue {
    const deduction = severity === Severity.Error ? 2.5 : 1.0;

    return {
      metric: 'longChain',
      severity,
      message: `Detected long execution chain without subtask decomposition: total steps ${totalSteps}, no subtasks used`,
      location: {
        stepRange: [0, totalSteps - 1],
      },
      suggestion: `For complex tasks, consider using the Agent tool to create subtasks and decompose a large task into multiple independent smaller tasks`,
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
    return ['plan', 'first', 'next'].some((token) => normalized.includes(token));
  }

  private hasValidationCue(text: string): boolean {
    if (!text) {
      return false;
    }
    const normalized = text.toLowerCase();
    return ['verify', 'check', 'test'].some((token) => normalized.includes(token));
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
