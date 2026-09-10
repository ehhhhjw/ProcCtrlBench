import { BaseEvaluator } from './BaseEvaluator';
import { SessionData, MessageNode } from '../../ClaudeCodeStructure/src/types';
import { EvaluationConfig, EvaluationResult, Severity } from '../types/evaluation.types';

/**
 * Task outcome evaluator
 * Evaluates task completion quality, including success rate, executability, and verification pass rate
 */
export class TaskOutcomeEvaluator extends BaseEvaluator {
  readonly name = 'TaskOutcomeEvaluator';
  readonly description = 'Evaluates task outcome quality, including task success rate, output executability, and verification pass rate';

  async evaluate(): Promise<EvaluationResult> {
    // 1. Evaluate the task completion rate
    const completionRate = this.evaluateTaskCompletionRate();

    // 2. Evaluate output executability
    const executability = this.evaluateOutputExecutability();

    // 3. Evaluate the verification pass rate
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
   * Evaluate the task completion rate
   * Use heuristics to determine whether the session completed successfully
   */
  private evaluateTaskCompletionRate(): number {
    const indicators = {
      hasFileChanges: this.hasFileChanges(),
      hasSuccessfulCommands: this.hasSuccessfulCommands(),
      noFatalErrors: this.noFatalErrors(),
      hasPositiveConclusion: this.hasPositiveConclusion(),
      sessionNotAborted: this.sessionNotAborted(),
    };

    // Count the passing indicators
    const passedCount = Object.values(indicators).filter(v => v).length;
    const totalCount = Object.keys(indicators).length;

    return passedCount / totalCount;
  }

  /**
   * Evaluate output executability
   * Check whether generated code and files are executable
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
   * Evaluate the verification pass rate
   * Check whether changes were verified and whether verification passed
   */
  private evaluateVerificationRate(): number {
    const modifications = this.countFileModifications();
    const verifications = this.countVerifications();
    const passedVerifications = this.countPassedVerifications();

    if (modifications === 0) {
      return 1.0; // No changes, so verification is unnecessary
    }

    if (verifications === 0) {
      return 0.3; // Changes were made but not verified
    }

    // Verification pass rate
    const passRate = verifications > 0 ? passedVerifications / verifications : 0;

    // Verification coverage rate
    const coverageRate = Math.min(verifications / modifications, 1.0);

    // Combined quality metric
    return passRate * 0.7 + coverageRate * 0.3;
  }

  /**
   * Check for file changes
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
   * Check for successful command executions
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
   * Check that there are no fatal errors
   */
  private noFatalErrors(): boolean {
    // Check the latest messages for error keywords
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
   * Check for a positive conclusion
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
   * Check whether the session was aborted
   */
  private sessionNotAborted(): boolean {
    // Check for signs of a normal ending
    const messages = Array.from(this.sessionData.messages.values());

    if (messages.length === 0) return false;

    // An unanswered final user message may indicate an abort
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.type === 'user' && lastMessage.children.length === 0) {
      return false;
    }

    return true;
  }

  /**
   * Check for a compilation check
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
   * Check for syntax validation
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
   * Check that there are no compilation errors
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

    // Pass by default when there is no compilation step
    if (!hasCompilation) return true;

    return !hasError;
  }

  /**
   * Check for runnable output
   */
  private hasRunnableOutput(): boolean {
    // Check whether an executable file was created
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
   * Count file modifications
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
   * Count verification attempts
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
   * Count passed verification attempts
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
   * Extract content
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
