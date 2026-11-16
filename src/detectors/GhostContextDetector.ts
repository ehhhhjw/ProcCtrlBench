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
 * Ghost context detector
 * Detects content that no longer provides value but still occupies context
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

    // Detection 1: summary coexisting with original content
    const summaryIssues = await this.detectSummaryDuplication();
    issues.push(...summaryIssues);

    // Detection 2: non-consumable payload
    const unusableIssues = await this.detectUnusablePayload();
    issues.push(...unusableIssues);

    // Detection 3: unreferenced historical result
    const unreferencedIssues = await this.detectUnreferencedHistory();
    issues.push(...unreferencedIssues);

    return finalizeDetectorIssues(issues, this.config);
  }

  /**
   * Detect summary coexisting with original content
   */
  private async detectSummaryDuplication(): Promise<DetectionIssue[]> {
    const issues: DetectionIssue[] = [];

    // Find content-replacement records
    const replacements = Array.from(this.sessionData.replacements.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    for (const replacement of replacements) {
      // Check whether the original content is still in the context
      const messageUuids = this.sessionData.messagesByMessageId.get(replacement.messageId);

      // Multiple fragments indicate the original content and the summary may coexist
      if (messageUuids && messageUuids.length > 1) {
        // Get the complete information for all fragments
        const messageFragments = messageUuids
          .map(uuid => this.sessionData.messages.get(uuid))
          .filter((m): m is MessageNode => m !== undefined);

        // Check the time difference between them
        const sortedFragments = messageFragments.sort((a: MessageNode, b: MessageNode) => a.timestamp - b.timestamp);
        const firstFragment = sortedFragments[0];
        const lastFragment = sortedFragments[sortedFragments.length - 1];

        const timeDiff = lastFragment.timestamp - firstFragment.timestamp;
        const steps = this.countStepsBetween(firstFragment.timestamp, lastFragment.timestamp);

        // Coexisting for more than 2 steps is treated as ghost context
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

          // Prewarn: alert when the wasted tokens are near the threshold
          if (wastedTokens > this.config.thresholds.ghostContext.warningTokens * 0.9) {
            writePrewarn({
              metric: 'ghostContext',
              message: `summary coexisting with original content, wasted tokens near threshold: wasted=${wastedTokens}`,
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
            message: `Detected summary coexisting with original content: messageId ${replacement.messageId}, approximately ${wastedTokens} tokens wasted`,
            location: {
              messageUuid: lastFragment.uuid,
            },
            suggestion: `The original content should be removed as soon as the summary is created, to avoid occupying the context twice`,
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
   * Detect non-consumable payload
   */
  private async detectUnusablePayload(): Promise<DetectionIssue[]> {
    const issues: DetectionIssue[] = [];

    // Check all tool-results
    for (const toolResult of this.sessionData.toolResults.values()) {
      const content = this.extractContent(toolResult.content);

      if (!content) continue;

      // Check whether the content is base64 or binary
      const isUnusable = this.isUnusableContent(content);

      if (isUnusable) {
        const tokenSize = this.estimateTokenSize(content);

        // Near-threshold prewarn (lets the runtime compress early or replace the content with a summary)
        if (tokenSize > this.config.thresholds.ghostContext.warningTokens * 0.9 && tokenSize <= this.config.thresholds.ghostContext.warningTokens) {
          const { writePrewarn } = require('../utils/Prewarn');
          try {
            writePrewarn({
              metric: 'ghostContext',
              message: `non-consumable payload near threshold: size=${tokenSize}`,
              details: { tokenSize },
            });
          } catch {}
        }

        // If the threshold is exceeded
        if (tokenSize > this.config.thresholds.ghostContext.warningTokens) {
          const severity = tokenSize > this.config.thresholds.ghostContext.errorTokens
            ? Severity.Error
            : Severity.Warning;

          const deduction = severity === Severity.Error ? 1.5 : 0.5;

          issues.push({
            metric: 'ghostContext',
            severity,
            message: `Detected large non-consumable payload: ${tokenSize} tokens of ${this.getContentType(content)} content`,
            location: {
              messageUuid: toolResult.messageUuid,
            },
            suggestion: `For binary or base64 content, the original content should be compressed or removed as soon as the key information has been extracted`,
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
   * Detect unreferenced historical result
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

      // Check whether it is referenced
      const footprint = this.codeContext.getTextFootprint(content);
      const isReferenced = this.isContentReferencedWithFootprint(content, subsequentMessages, footprint);

      // Check whether a covering summary exists
      const hasSummary = this.hasReplacementSummary(result.messageId, result.timestamp);

      if (!isReferenced && hasSummary) {
        const tokenSize = this.estimateTokenSize(content);

        if (tokenSize > this.config.thresholds.ghostContext.warningTokens) {
          const severity = Severity.Warning;
          const deduction = 0.5;

          issues.push({
            metric: 'ghostContext',
            severity,
            message: `Detected unreferenced historical result: ${tokenSize} tokens, not referenced within 5 steps and a summary exists`,
            location: {
              messageUuid: result.messageUuid,
            },
            suggestion: `This result is not used in the subsequent steps and a summary already exists, so the original content can be removed`,
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
   * Determine whether the content is non-consumable
   */
  private isUnusableContent(content: string): boolean {
    // Check base64
    const base64Pattern = /^[A-Za-z0-9+/=]{100,}$/;
    if (base64Pattern.test(content.replace(/\s/g, ''))) {
      return true;
    }

    // Check whether it contains many binary markers
    const binaryIndicators = ['�', '\x00', '\xFF', 'binary', 'image/'];
    const binaryCount = binaryIndicators.reduce((count, indicator) => {
      return count + (content.match(new RegExp(indicator, 'g'))?.length || 0);
    }, 0);

    if (binaryCount > 10) {
      return true;
    }

    // Check for extremely long single-line content (possibly compressed data)
    const lines = content.split('\n');
    const hasVeryLongLine = lines.some(line => line.length > 1000);

    return hasVeryLongLine && lines.length < 5;
  }

  /**
   * Get content type
   */
  private getContentType(content: string): string {
    if (/^[A-Za-z0-9+/=]{100,}$/.test(content.replace(/\s/g, ''))) {
      return 'base64';
    }

    if (content.includes('�') || content.includes('\x00')) {
      return 'binary';
    }

    return 'unknown format';
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
   * Count the steps within a time range
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
   * Get the messages after a given time
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
   * Check whether the content is referenced
   */
  private isContentReferenced(content: string, messages: MessageNode[]): boolean {
    return this.isContentReferencedWithFootprint(content, messages, this.codeContext.getTextFootprint(content));
  }

  private isContentReferencedWithFootprint(content: string, messages: MessageNode[], footprint: CodeFootprint): boolean {
    // Extract keywords
    const keywords = content
      .split(/\s+/)
      .filter(w => w.length >= 5)
      .slice(0, 10);

    for (const message of messages) {
      const messageText = this.extractContent(message.content);

      // Check whether it contains keywords
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
   * Check whether a replacement summary exists
   */
  private hasReplacementSummary(messageId: string, afterTime: number): boolean {
    // Find all related replacement records in the replacements Map
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
