import { SessionData, MessageNode } from '../../ClaudeCodeStructure/src/types';
import { IDetector, DetectionIssue, Severity, EvaluationConfig } from '../types/evaluation.types';
import { writePrewarn } from '../utils/Prewarn';
import { finalizeDetectorIssues } from './detector-calibration';

/**
 * 规则膨胀检测器
 * 检测System instructions或rules过大，增加token负担
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

    // 获取所有system类型消息
    const systemMessages = Array.from(this.sessionData.messages.values())
      .filter(m => m.type === 'system')
      .sort((a, b) => a.timestamp - b.timestamp);

    if (systemMessages.length === 0) {
      return issues; // 没有system消息
    }

    // 分析每个system消息
    for (const systemMessage of systemMessages) {
      const content = this.extractContent(systemMessage.content);
      const tokenSize = this.estimateTokenSize(content);

      // 计算该消息在总上下文中的占比
      const totalTokens = this.calculateTotalContextTokens(systemMessage.timestamp);
      const ratio = totalTokens > 0 ? tokenSize / totalTokens : 0;

      // 检查是否超过阈值
      const sizeWarning = tokenSize > this.config.thresholds.oversizedRules.warningTokens;
      const sizeError = tokenSize > this.config.thresholds.oversizedRules.errorTokens;
      const ratioWarning = ratio > this.config.thresholds.oversizedRules.warningRatio;
      const ratioError = ratio > this.config.thresholds.oversizedRules.errorRatio;

      // 接近阈值的预警：帮助运行时提前压缩或精简
      const nearSizeWarn = tokenSize >= Math.floor(this.config.thresholds.oversizedRules.warningTokens * 0.9) && tokenSize < this.config.thresholds.oversizedRules.warningTokens;
      const nearRatioWarn = ratio >= this.config.thresholds.oversizedRules.warningRatio * 0.9 && ratio < this.config.thresholds.oversizedRules.warningRatio;
      if (nearSizeWarn || nearRatioWarn) {
        writePrewarn({
          metric: 'oversizedRules',
          message: `System规则接近阈值: size=${tokenSize}, ratio=${(ratio*100).toFixed(1)}%`,
          details: { tokenSize, ratio },
        });
      }

      if (sizeError || ratioError) {
        // Error级别
        issues.push({
          metric: 'oversizedRules',
          severity: Severity.Error,
          message: `System规则过大: ${tokenSize} tokens (${(ratio * 100).toFixed(1)}% 的总上下文)`,
          location: {
            messageUuid: systemMessage.uuid,
          },
          suggestion: `System规则占用过多上下文空间。考虑精简规则、移除冗余说明、或将非核心规则放到外部文档`,
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
        // Warning级别
        issues.push({
          metric: 'oversizedRules',
          severity: Severity.Warning,
          message: `System规则较大: ${tokenSize} tokens (${(ratio * 100).toFixed(1)}% 的总上下文)`,
          location: {
            messageUuid: systemMessage.uuid,
          },
          suggestion: `System规则占用较多上下文空间。建议审查是否有可以精简的内容`,
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

      // 检查是否是最大的单块静态内容
      const isLargestBlock = this.isLargestStaticContent(systemMessage, tokenSize);

      if (isLargestBlock && tokenSize > 1000) {
        issues.push({
          metric: 'oversizedRules',
          severity: Severity.Warning,
          message: `System规则是最大的单块静态内容: ${tokenSize} tokens`,
          location: {
            messageUuid: systemMessage.uuid,
          },
          suggestion: `考虑将部分规则改为动态加载，或按需提供`,
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
   * 提取内容
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
   * 估算token大小
   */
  private estimateTokenSize(content: string): number {
    // 简单估算: 英文约4字符=1token, 中文约1.5字符=1token
    const chineseChars = (content.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = content.length - chineseChars;

    return Math.ceil(chineseChars / 1.5 + otherChars / 4);
  }

  /**
   * 计算指定时间点的总上下文tokens
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
   * 检查是否是最大的静态内容块
   */
  private isLargestStaticContent(systemMessage: MessageNode, systemTokenSize: number): boolean {
    // 获取所有静态内容（system、attachment等）
    const staticMessages = Array.from(this.sessionData.messages.values())
      .filter(m => m.type === 'system' || m.type === 'attachment');

    let maxSize = systemTokenSize;

    for (const message of staticMessages) {
      if (message.uuid !== systemMessage.uuid) {
        const content = this.extractContent(message.content);
        const size = this.estimateTokenSize(content);

        if (size > maxSize) {
          return false; // 找到更大的
        }
      }
    }

    return true;
  }
}
