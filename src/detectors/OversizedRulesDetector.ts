import { SessionData, MessageNode } from '../../ClaudeCodeStructure/src/types';
import { IDetector, DetectionIssue, Severity, EvaluationConfig } from '../types/evaluation.types';
import { writePrewarn } from '../utils/Prewarn';
import { finalizeDetectorIssues } from './detector-calibration';

/**
 * Rule bloat detector
 * Detects System instructions or rules that are too large and add token overhead
 */
export class OversizedRulesDetector implements IDetector {
  readonly name = 'OversizedRulesDetector';
  private sessionData: SessionData;
  private config: EvaluationConfig;

  constructor(sessionData: SessionData, config: EvaluationConfig) {
    this.sessionData = sessionData;
    this.config = config;
  }

  async detect(): Promise<DetectionIssue[]> {
    const issues: DetectionIssue[] = [];

    // Get all system-type messages
    const systemMessages = Array.from(this.sessionData.messages.values())
      .filter(m => m.type === 'system')
      .sort((a, b) => a.timestamp - b.timestamp);

    if (systemMessages.length === 0) {
      return issues; // No system messages
    }

    // Analyze each system message
    for (const systemMessage of systemMessages) {
      const content = this.extractContent(systemMessage.content);
      const tokenSize = this.estimateTokenSize(content);

      // Compute this message's share of the total context
      const totalTokens = this.calculateTotalContextTokens(systemMessage.timestamp);
      const ratio = totalTokens > 0 ? tokenSize / totalTokens : 0;

      // Check whether the thresholds are exceeded
      const sizeWarning = tokenSize > this.config.thresholds.oversizedRules.warningTokens;
      const sizeError = tokenSize > this.config.thresholds.oversizedRules.errorTokens;
      const ratioWarning = ratio > this.config.thresholds.oversizedRules.warningRatio;
      const ratioError = ratio > this.config.thresholds.oversizedRules.errorRatio;

      // Prewarn when near the threshold: helps the runtime compress or trim ahead of time
      const nearSizeWarn = tokenSize >= Math.floor(this.config.thresholds.oversizedRules.warningTokens * 0.9) && tokenSize < this.config.thresholds.oversizedRules.warningTokens;
      const nearRatioWarn = ratio >= this.config.thresholds.oversizedRules.warningRatio * 0.9 && ratio < this.config.thresholds.oversizedRules.warningRatio;
      if (nearSizeWarn || nearRatioWarn) {
        writePrewarn({
          metric: 'oversizedRules',
          message: `System rules near threshold: size=${tokenSize}, ratio=${(ratio*100).toFixed(1)}%`,
          details: { tokenSize, ratio },
        });
      }

      if (sizeError || ratioError) {
        // Error level
        issues.push({
          metric: 'oversizedRules',
          severity: Severity.Error,
          message: `Detected oversized system rules: ${tokenSize} tokens (${(ratio * 100).toFixed(1)}% of the total context)`,
          location: {
            messageUuid: systemMessage.uuid,
          },
          suggestion: `System rules take up too much context space. Consider trimming the rules, removing redundant explanations, or moving non-essential rules into external documents`,
          evidence: {
            type: 'strong',
            details: {
              tokenSize,
              totalTokens,
              ratio: (ratio * 100).toFixed(1) + '%',
              contentPreview: content.substring(0, 200) + '...',
            },
          },
          deduction: 1.5,
        });
      } else if (sizeWarning || ratioWarning) {
        // Warning level
        issues.push({
          metric: 'oversizedRules',
          severity: Severity.Warning,
          message: `System rules are fairly large: ${tokenSize} tokens (${(ratio * 100).toFixed(1)}% of the total context)`,
          location: {
            messageUuid: systemMessage.uuid,
          },
          suggestion: `System rules take up a considerable amount of context space. Review whether any content can be trimmed`,
          evidence: {
            type: 'medium',
            details: {
              tokenSize,
              totalTokens,
              ratio: (ratio * 100).toFixed(1) + '%',
            },
          },
          deduction: 0.5,
        });
      }

      // Check whether it is the largest single block of static content
      const isLargestBlock = this.isLargestStaticContent(systemMessage, tokenSize);

      if (isLargestBlock && tokenSize > 1000) {
        issues.push({
          metric: 'oversizedRules',
          severity: Severity.Warning,
          message: `System rules are the largest single block of static content: ${tokenSize} tokens`,
          location: {
            messageUuid: systemMessage.uuid,
          },
          suggestion: `Consider loading some rules dynamically, or providing them on demand`,
          evidence: {
            type: 'medium',
            details: {
              tokenSize,
              isLargestBlock: true,
            },
          },
          deduction: 0.5,
        });
      }
    }

    return finalizeDetectorIssues(issues, this.config);
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
        .map((block: any) => block.text)
        .join('\n');
    }

    return '';
  }

  /**
   * Estimate token size
   */
  private estimateTokenSize(content: string): number {
    // Rough estimate: about 4 English characters = 1 token, about 1.5 Chinese characters = 1 token
    const chineseChars = (content.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = content.length - chineseChars;

    return Math.ceil(chineseChars / 1.5 + otherChars / 4);
  }

  /**
   * Compute the total context tokens at a given point in time
   */
  private calculateTotalContextTokens(timestamp: number): number {
    let totalTokens = 0;

    for (const message of this.sessionData.messages.values()) {
      if (message.timestamp <= timestamp && message.usage) {
        totalTokens += message.usage.input_tokens + message.usage.output_tokens;
      }
    }

    return totalTokens;
  }

  /**
   * Check whether it is the largest block of static content
   */
  private isLargestStaticContent(systemMessage: MessageNode, systemTokenSize: number): boolean {
    // Get all static content (system, attachment, etc.)
    const staticMessages = Array.from(this.sessionData.messages.values())
      .filter(m => m.type === 'system' || m.type === 'attachment');

    let maxSize = systemTokenSize;

    for (const message of staticMessages) {
      if (message.uuid !== systemMessage.uuid) {
        const content = this.extractContent(message.content);
        const size = this.estimateTokenSize(content);

        if (size > maxSize) {
          return false; // Found a larger one
        }
      }
    }

    return true;
  }
}
