import { SessionData, MessageNode, ContentReplacementRecord } from '../../ClaudeCodeStructure/src/types';
import { IDetector, DetectionIssue, Severity, EvaluationConfig } from '../types/evaluation.types';
import { GhostContextInfo } from '../types/metrics.types';
import { AstAnalyzer } from '../analyzers/AstAnalyzer';
import { ProjectAstLoader } from '../analyzers/ProjectAstLoader';
import { CodeContextAnalyzer, CodeFootprint } from '../analyzers/CodeContextAnalyzer';
import { ContextChainAnalyzer } from '../analyzers/ContextChainAnalyzer';
import { writePrewarn } from '../utils/Prewarn';
import { finalizeDetectorIssues } from './detector-calibration';

/**
 * 幽灵上下文检测器
 * 检测已无价值但仍占用上下文的内容
 */
export class GhostContextDetector implements IDetector {
  readonly name = 'GhostContextDetector';
  private sessionData: SessionData;
  private config: EvaluationConfig;
  private ast?: AstAnalyzer;
  private projectAst?: ProjectAstLoader;
  private codeContext: CodeContextAnalyzer;
  private contextChains: ContextChainAnalyzer;

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
    this.contextChains = new ContextChainAnalyzer(this.sessionData);
  }

  async detect(): Promise<DetectionIssue[]> {
    const issues: DetectionIssue[] = [];

    // 检测1: 摘要+原文共存
    const summaryIssues = await this.detectSummaryDuplication();
    issues.push(...summaryIssues);

    // 检测2: 不可消费的payload
    const unusableIssues = await this.detectUnusablePayload();
    issues.push(...unusableIssues);

    // 检测3: 未被引用的历史结果
    const unreferencedIssues = await this.detectUnreferencedHistory();
    issues.push(...unreferencedIssues);

    return finalizeDetectorIssues(issues, this.config);
  }

  /**
   * 检测摘要+原文共存
   */
  private async detectSummaryDuplication(): Promise<DetectionIssue[]> {
    const issues: DetectionIssue[] = [];

    // 查找content-replacement记录
    const replacements = Array.from(this.sessionData.replacements.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    for (const replacement of replacements) {
      // 检查原始内容是否仍在上下文中
      const messageUuids = this.sessionData.messagesByMessageId.get(replacement.messageId);

      // 如果存在多个片段，说明原文和摘要可能共存
      if (messageUuids && messageUuids.length > 1) {
        // 获取所有片段的完整信息
        const messageFragments = messageUuids
          .map(uuid => this.sessionData.messages.get(uuid))
          .filter((m): m is MessageNode => m !== undefined);

        // 检查它们之间的时间差
        const sortedFragments = messageFragments.sort((a: MessageNode, b: MessageNode) => a.timestamp - b.timestamp);
        const firstFragment = sortedFragments[0];
        const lastFragment = sortedFragments[sortedFragments.length - 1];

        const timeDiff = lastFragment.timestamp - firstFragment.timestamp;
        const steps = this.countStepsBetween(firstFragment.timestamp, lastFragment.timestamp);

        // 如果共存超过2个步骤，认为是ghost context
        if (steps > 2) {
          const originalSize = this.estimateTokenSize(replacement.originalContent);
          const replacementSize = this.estimateTokenSize(replacement.replacementContent);
          const wastedTokens = originalSize - replacementSize;
          const originalFootprint = this.codeContext.getTextFootprint(replacement.originalContent);
          const stillActive = this.hasActiveCodeReference(
            originalFootprint,
            this.getMessagesAfter(firstFragment.uuid, firstFragment.timestamp, steps + 2)
          );

          if (stillActive) {
            continue;
          }

          // 预警：浪费接近阈值时提醒
          if (wastedTokens > this.config.thresholds.ghostContext.warningTokens * 0.9) {
            writePrewarn({
              metric: 'ghostContext',
              message: `摘要与原文共存浪费接近阈值: wasted=${wastedTokens}`,
              details: { wastedTokens, steps },
            });
          }

          const severity = wastedTokens > this.config.thresholds.ghostContext.errorTokens
            ? Severity.Error
            : Severity.Warning;

          const deduction = severity === Severity.Error ? 1.5 : 0.5;

          issues.push({
            metric: 'ghostContext',
            severity,
            message: `检测到摘要与原文共存: messageId ${replacement.messageId}, 浪费约 ${wastedTokens} tokens`,
            location: {
              messageUuid: lastFragment.uuid,
            },
            suggestion: `摘要创建后应立即移除原始内容，避免重复占用上下文`,
            evidence: {
              type: 'medium',
              details: {
                type: 'summary_duplication',
                originalSize,
                replacementSize,
                wastedTokens,
                coexistSteps: steps,
                codeFootprint: this.codeContext.summarizeFootprint(originalFootprint),
              },
            },
            deduction,
          });
        }
      }
    }

    return issues;
  }

  /**
   * 检测不可消费的payload
   */
  private async detectUnusablePayload(): Promise<DetectionIssue[]> {
    const issues: DetectionIssue[] = [];

    // 检查所有tool-result
    for (const toolResult of this.sessionData.toolResults.values()) {
      const content = this.extractContent(toolResult.content);

      if (!content) continue;

      // 检查是否是base64或二进制内容
      const isUnusable = this.isUnusableContent(content);

      if (isUnusable) {
        const tokenSize = this.estimateTokenSize(content);

        // 接近阈值的预警（便于运行时提前压缩或替换为摘要）
        if (tokenSize > this.config.thresholds.ghostContext.warningTokens * 0.9 && tokenSize <= this.config.thresholds.ghostContext.warningTokens) {
          const { writePrewarn } = require('../utils/Prewarn');
          try {
            writePrewarn({
              metric: 'ghostContext',
              message: `不可消费payload接近阈值: size=${tokenSize}`,
              details: { tokenSize },
            });
          } catch {}
        }

        // 如果超过阈值
        if (tokenSize > this.config.thresholds.ghostContext.warningTokens) {
          const severity = tokenSize > this.config.thresholds.ghostContext.errorTokens
            ? Severity.Error
            : Severity.Warning;

          const deduction = severity === Severity.Error ? 1.5 : 0.5;

          issues.push({
            metric: 'ghostContext',
            severity,
            message: `检测到不可消费的大payload: ${tokenSize} tokens的${this.getContentType(content)}内容`,
            location: {
              messageUuid: toolResult.messageUuid,
            },
            suggestion: `对于二进制或base64内容，应在提取关键信息后立即压缩或移除原始内容`,
            evidence: {
              type: 'strong',
              details: {
                type: 'unusable_payload',
                tokenSize,
                contentType: this.getContentType(content),
              },
            },
            deduction,
          });
        }
      }
    }

    return issues;
  }

  /**
   * 检测未被引用的历史结果
   */
  private async detectUnreferencedHistory(): Promise<DetectionIssue[]> {
    const issues: DetectionIssue[] = [];

    const toolResults = Array.from(this.sessionData.toolResults.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    for (let i = 0; i < toolResults.length; i++) {
      const result = toolResults[i];
      const content = this.extractContent(result.content);

      if (!content) continue;

      const subsequentMessages = this.getMessagesAfter(result.messageUuid, result.timestamp, 5);

      // 检查是否被引用
      const footprint = this.codeContext.getTextFootprint(content);
      const isReferenced = this.isContentReferencedWithFootprint(content, subsequentMessages, footprint);

      // 检查是否有覆盖性摘要
      const hasSummary = this.hasReplacementSummary(result.messageId, result.timestamp);

      if (!isReferenced && hasSummary) {
        const tokenSize = this.estimateTokenSize(content);

        if (tokenSize > this.config.thresholds.ghostContext.warningTokens) {
          const severity = Severity.Warning;
          const deduction = 0.5;

          issues.push({
            metric: 'ghostContext',
            severity,
            message: `检测到未被引用的历史结果: ${tokenSize} tokens, 5步内无引用且存在摘要`,
            location: {
              messageUuid: result.messageUuid,
            },
            suggestion: `该结果在后续步骤中未被使用，且已有摘要，可以移除原始内容`,
            evidence: {
              type: 'medium',
              details: {
                type: 'unreferenced_history',
                tokenSize,
                subsequentSteps: 5,
                codeFootprint: this.codeContext.summarizeFootprint(footprint),
              },
            },
            deduction,
          });
        }
      }
    }

    return issues;
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
   * 判断是否是不可消费的内容
   */
  private isUnusableContent(content: string): boolean {
    // 检查base64
    const base64Pattern = /^[A-Za-z0-9+/=]{100,}$/;
    if (base64Pattern.test(content.replace(/\s/g, ''))) {
      return true;
    }

    // 检查是否包含大量二进制标识
    const binaryIndicators = ['�', '\x00', '\xFF', 'binary', 'image/'];
    const binaryCount = binaryIndicators.reduce((count, indicator) => {
      return count + (content.match(new RegExp(indicator, 'g'))?.length || 0);
    }, 0);

    if (binaryCount > 10) {
      return true;
    }

    // 检查是否是超长的单行内容（可能是压缩数据）
    const lines = content.split('\n');
    const hasVeryLongLine = lines.some(line => line.length > 1000);

    return hasVeryLongLine && lines.length < 5;
  }

  /**
   * 获取内容类型
   */
  private getContentType(content: string): string {
    if (/^[A-Za-z0-9+/=]{100,}$/.test(content.replace(/\s/g, ''))) {
      return 'base64';
    }

    if (content.includes('�') || content.includes('\x00')) {
      return '二进制';
    }

    return '未知格式';
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
   * 计算时间范围内的步骤数
   */
  private countStepsBetween(startTime: number, endTime: number): number {
    let count = 0;

    for (const message of this.sessionData.messages.values()) {
      if (message.timestamp > startTime && message.timestamp <= endTime) {
        count++;
      }
    }

    return count;
  }

  /**
   * 获取指定时间后的消息
   */
  private getMessagesAfter(anchorUuid: string, timestamp: number, count: number): MessageNode[] {
    if (this.sessionData.messages.has(anchorUuid)) {
      return this.contextChains.getFutureContextMessages(anchorUuid, count);
    }

    return Array.from(this.sessionData.messages.values())
      .filter(m => m.timestamp > timestamp)
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, count);
  }

  /**
   * 检查内容是否被引用
   */
  private isContentReferenced(content: string, messages: MessageNode[]): boolean {
    return this.isContentReferencedWithFootprint(content, messages, this.codeContext.getTextFootprint(content));
  }

  private isContentReferencedWithFootprint(content: string, messages: MessageNode[], footprint: CodeFootprint): boolean {
    // 提取关键词
    const keywords = content
      .split(/\s+/)
      .filter(w => w.length >= 5)
      .slice(0, 10);

    for (const message of messages) {
      const messageText = this.extractContent(message.content);

      // 检查是否包含关键词
      for (const keyword of keywords) {
        if (messageText.includes(keyword)) {
          return true;
        }
      }

      const messageFootprint = this.codeContext.getMessageFootprint(message);
      if (this.codeContext.hasMeaningfulOverlap(footprint, messageFootprint, 0.2)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 检查是否有替换摘要
   */
  private hasReplacementSummary(messageId: string, afterTime: number): boolean {
    // 从replacements Map中查找所有相关的替换记录
    const replacements: ContentReplacementRecord[] = [];
    for (const replacement of this.sessionData.replacements.values()) {
      if (replacement.messageId === messageId) {
        replacements.push(replacement);
      }
    }
    return replacements.some((r: ContentReplacementRecord) => r.timestamp > afterTime);
  }

  private hasActiveCodeReference(footprint: CodeFootprint, messages: MessageNode[]): boolean {
    if (
      footprint.directFiles.size === 0 &&
      footprint.strongRelatedFiles.size === 0 &&
      footprint.weakRelatedFiles.size === 0 &&
      footprint.symbols.size === 0
    ) {
      return false;
    }

    return messages.some((message) => {
      const messageFootprint = this.codeContext.getMessageFootprint(message);
      return this.codeContext.hasMeaningfulOverlap(footprint, messageFootprint, 0.2);
    });
  }
}
