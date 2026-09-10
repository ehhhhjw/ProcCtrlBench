import { BaseEvaluator } from './BaseEvaluator';
import { SessionData, MessageNode } from '../../ClaudeCodeStructure/src/types';
import { EvaluationConfig, EvaluationResult, Severity } from '../types/evaluation.types';

/**
 * 任务结果评估器
 * 评估任务完成质量，包括成功率、可执行性和验证通过率
 */
export class TaskOutcomeEvaluator extends BaseEvaluator {
  readonly name = 'TaskOutcomeEvaluator';
  readonly description = '评估任务结果质量，包括任务成功率、输出可执行性和验证通过率';

  async evaluate(): Promise<EvaluationResult> {
    // 1. 评估任务完成率
    const completionRate = this.evaluateTaskCompletionRate();

    // 2. 评估输出可执行性
    const executability = this.evaluateOutputExecutability();

    // 3. 评估验证通过率
    const verificationRate = this.evaluateVerificationRate();

    return {
      dimension: 'taskOutcome',
      warnings: 0,
      errors: 0,
      issues: [],
      details: {
        taskCompletionRate: completionRate,
        outputExecutability: executability,
        postModificationVerificationRate: verificationRate,
      },
    };
  }

  /**
   * 评估任务完成率
   * 基于启发式分析session是否成功完成
   */
  private evaluateTaskCompletionRate(): number {
    const indicators = {
      hasFileChanges: this.hasFileChanges(),
      hasSuccessfulCommands: this.hasSuccessfulCommands(),
      noFatalErrors: this.noFatalErrors(),
      hasPositiveConclusion: this.hasPositiveConclusion(),
      sessionNotAborted: this.sessionNotAborted(),
    };

    // 计算通过的指标数量
    const passedCount = Object.values(indicators).filter(v => v).length;
    const totalCount = Object.keys(indicators).length;

    return passedCount / totalCount;
  }

  /**
   * 评估输出可执行性
   * 检查生成的代码/文件是否可执行
   */
  private evaluateOutputExecutability(): number {
    const indicators = {
      hasCompilationCheck: this.hasCompilationCheck(),
      hasSyntaxValidation: this.hasSyntaxValidation(),
      noCompilationErrors: this.noCompilationErrors(),
      hasRunnableOutput: this.hasRunnableOutput(),
    };

    const passedCount = Object.values(indicators).filter(v => v).length;
    const totalCount = Object.keys(indicators).length;

    return passedCount / totalCount;
  }

  /**
   * 评估验证通过率
   * 检查修改后是否进行了验证，以及验证是否通过
   */
  private evaluateVerificationRate(): number {
    const modifications = this.countFileModifications();
    const verifications = this.countVerifications();
    const passedVerifications = this.countPassedVerifications();

    if (modifications === 0) {
      return 1.0; // 没有修改，不需要验证
    }

    if (verifications === 0) {
      return 0.3; // 有修改但没有验证
    }

    // 验证通过率
    const passRate = verifications > 0 ? passedVerifications / verifications : 0;

    // 验证覆盖率
    const coverageRate = Math.min(verifications / modifications, 1.0);

    // 综合质量指标
    return passRate * 0.7 + coverageRate * 0.3;
  }

  /**
   * 检查是否有文件变更
   */
  private hasFileChanges(): boolean {
    for (const toolUse of this.sessionData.toolUses.values()) {
      if (toolUse.name === 'Write' || toolUse.name === 'Edit') {
        const result = this.sessionData.toolResults.get(toolUse.id);
        if (result && !result.is_error) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 检查是否有成功的命令执行
   */
  private hasSuccessfulCommands(): boolean {
    let successCount = 0;
    let totalCount = 0;

    for (const toolUse of this.sessionData.toolUses.values()) {
      if (toolUse.name === 'Bash') {
        totalCount++;
        const result = this.sessionData.toolResults.get(toolUse.id);
        if (result && !result.is_error) {
          successCount++;
        }
      }
    }

    return totalCount > 0 && successCount / totalCount > 0.7;
  }

  /**
   * 检查是否没有致命错误
   */
  private noFatalErrors(): boolean {
    // 检查最后几条消息是否包含错误关键词
    const messages = Array.from(this.sessionData.messages.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    const lastMessages = messages.slice(-5);

    for (const message of lastMessages) {
      if (message.type === 'assistant') {
        const content = this.extractContent(message.content);
        const fatalKeywords = [
          'fatal error',
          'cannot proceed',
          'task failed',
          'unable to complete',
          'critical error',
        ];

        for (const keyword of fatalKeywords) {
          if (content.toLowerCase().includes(keyword)) {
            return false;
          }
        }
      }
    }

    return true;
  }

  /**
   * 检查是否有积极的结论
   */
  private hasPositiveConclusion(): boolean {
    const messages = Array.from(this.sessionData.messages.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    const lastMessages = messages.slice(-3);

    for (const message of lastMessages) {
      if (message.type === 'assistant') {
        const content = this.extractContent(message.content);
        const positiveKeywords = [
          'completed',
          'success',
          'done',
          'finished',
          'ready',
          '完成',
          '成功',
          '已完成',
        ];

        for (const keyword of positiveKeywords) {
          if (content.toLowerCase().includes(keyword)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * 检查session是否被中止
   */
  private sessionNotAborted(): boolean {
    // 检查是否有正常结束的迹象
    const messages = Array.from(this.sessionData.messages.values());

    if (messages.length === 0) return false;

    // 如果最后一条消息是user消息且没有回复，可能是中止
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.type === 'user' && lastMessage.children.length === 0) {
      return false;
    }

    return true;
  }

  /**
   * 检查是否有编译检查
   */
  private hasCompilationCheck(): boolean {
    for (const toolUse of this.sessionData.toolUses.values()) {
      if (toolUse.name === 'Bash') {
        const command = toolUse.input.command || '';
        const compilationCommands = [
          'npm run build',
          'yarn build',
          'tsc',
          'compile',
          'mvn compile',
          'gradle build',
          'cargo build',
          'go build',
        ];

        for (const cmd of compilationCommands) {
          if (command.includes(cmd)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * 检查是否有语法验证
   */
  private hasSyntaxValidation(): boolean {
    for (const toolUse of this.sessionData.toolUses.values()) {
      if (toolUse.name === 'Bash') {
        const command = toolUse.input.command || '';
        const validationCommands = [
          'eslint',
          'pylint',
          'flake8',
          'rubocop',
          'clippy',
          'syntax',
        ];

        for (const cmd of validationCommands) {
          if (command.includes(cmd)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * 检查是否没有编译错误
   */
  private noCompilationErrors(): boolean {
    let hasCompilation = false;
    let hasError = false;

    for (const toolUse of this.sessionData.toolUses.values()) {
      if (toolUse.name === 'Bash') {
        const command = toolUse.input.command || '';
        const isCompilation = command.includes('build') || command.includes('compile');

        if (isCompilation) {
          hasCompilation = true;
          const result = this.sessionData.toolResults.get(toolUse.id);

          if (result && result.is_error) {
            hasError = true;
          }
        }
      }
    }

    // 如果没有编译步骤，默认通过
    if (!hasCompilation) return true;

    return !hasError;
  }

  /**
   * 检查是否有可运行的输出
   */
  private hasRunnableOutput(): boolean {
    // 检查是否创建了可执行文件
    for (const toolUse of this.sessionData.toolUses.values()) {
      if (toolUse.name === 'Write') {
        const filePath = toolUse.input.file_path || '';
        const runnableExtensions = ['.js', '.ts', '.py', '.sh', '.rb', '.go'];

        for (const ext of runnableExtensions) {
          if (filePath.endsWith(ext)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * 统计文件修改次数
   */
  private countFileModifications(): number {
    let count = 0;

    for (const toolUse of this.sessionData.toolUses.values()) {
      if (toolUse.name === 'Write' || toolUse.name === 'Edit') {
        const result = this.sessionData.toolResults.get(toolUse.id);
        if (result && !result.is_error) {
          count++;
        }
      }
    }

    return count;
  }

  /**
   * 统计验证次数
   */
  private countVerifications(): number {
    let count = 0;

    for (const toolUse of this.sessionData.toolUses.values()) {
      if (toolUse.name === 'Bash') {
        const command = toolUse.input.command || '';
        const verificationCommands = [
          'test',
          'npm test',
          'yarn test',
          'pytest',
          'jest',
          'mocha',
          'cargo test',
          'go test',
          'mvn test',
        ];

        for (const cmd of verificationCommands) {
          if (command.includes(cmd)) {
            count++;
            break;
          }
        }
      }
    }

    return count;
  }

  /**
   * 统计通过的验证次数
   */
  private countPassedVerifications(): number {
    let count = 0;

    for (const toolUse of this.sessionData.toolUses.values()) {
      if (toolUse.name === 'Bash') {
        const command = toolUse.input.command || '';
        const isVerification = command.includes('test');

        if (isVerification) {
          const result = this.sessionData.toolResults.get(toolUse.id);
          if (result && !result.is_error) {
            count++;
          }
        }
      }
    }

    return count;
  }

  /**
   * 提取内容
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
