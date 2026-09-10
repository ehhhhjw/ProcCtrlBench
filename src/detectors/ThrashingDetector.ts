import { SessionData, MessageNode, ContentReplacementRecord } from '../../ClaudeCodeStructure/src/types';
import { IDetector, DetectionIssue, Severity, EvaluationConfig } from '../types/evaluation.types';
import { ThrashingInfo } from '../types/metrics.types';
import { AstAnalyzer } from '../analyzers/AstAnalyzer';
import { ProjectAstLoader } from '../analyzers/ProjectAstLoader';
import { CodeContextAnalyzer, CodeFootprint } from '../analyzers/CodeContextAnalyzer';
import { ContextChainAnalyzer } from '../analyzers/ContextChainAnalyzer';
import { writePrewarn } from '../utils/Prewarn';
import { finalizeDetectorIssues } from './detector-calibration';

/**
 * Context window thrashing detector
 * Detects compression triggered immediately after a large read, leaving the information underused
 */
export class ThrashingDetector implements IDetector {
  readonly name = 'ThrashingDetector';
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

    // Get all messages sorted by time
    const messages = Array.from(this.sessionData.messages.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];

      // Compute the context token counts before and after this step
      const { tokensBefore, tokensAfter } = this.contextChains.getContextTokenStats(message.uuid);

      // Check whether the window limit is being approached
      const windowThreshold = this.config.contextWindowSize * this.config.thresholds.thrashing.windowThreshold;

      // Prewarn: the boundary just before the window threshold (75%)
      if (tokensAfter > windowThreshold * 0.95) {
        writePrewarn({
          metric: 'contextThrashing',
          message: `Context usage near threshold: ${(tokensAfter / this.config.contextWindowSize * 100).toFixed(1)}%`,
          details: { step: i, tokensAfter },
        });
      }
      if (tokensAfter > windowThreshold) {
        // Check whether compression occurs in subsequent steps
        const nextSteps = this.contextChains.getFutureContextMessages(
          message.uuid,
          this.config.thresholds.thrashing.compressionLookAhead
        );
        const compressionDelay = this.findCompressionDelay(nextSteps);

        if (compressionDelay >= 0) {
          // Thrashing found
          const payloadSize = tokensAfter - tokensBefore;
          const windowCapacity = this.config.contextWindowSize - tokensBefore;
          const payloadFootprint = this.getPayloadFootprint(message);
          const messagesBeforeCompression = nextSteps.slice(0, Math.max(compressionDelay - 1, 0));
          const reusedBeforeCompression = this.hasFootprintReuse(payloadFootprint, messagesBeforeCompression);
          const reusedWithinLookahead = this.hasFootprintReuse(payloadFootprint, nextSteps);

          if (reusedBeforeCompression) {
            continue;
          }

          // Determine the type
          let thrashingType: 'timing_fault' | 'payload_oversize_fault';
          let severity: Severity;

          if (payloadSize < windowCapacity * 0.5) {
            // Timing Fault: compression happened too late
            thrashingType = 'timing_fault';
            severity = Severity.Warning;
          } else {
            // Payload Oversize Fault: a single object is too large
            thrashingType = 'payload_oversize_fault';
            severity = Severity.Warning;
          }

          const deduction = 1.0;

          issues.push({
            metric: 'contextThrashing',
            severity,
            message: `Detected context window thrashing (${thrashingType}): step ${i} added ${payloadSize} tokens, and compression was triggered ${compressionDelay} steps later`,
            location: {
              stepRange: [i, i + compressionDelay],
              messageUuid: message.uuid,
            },
            suggestion: thrashingType === 'timing_fault'
              ? `Compress in time before nearing the window limit, to avoid abrupt overruns`
              : `The content added in a single step is too large (${payloadSize} tokens); consider processing it in batches or summarizing it beforehand`,
            evidence: {
              type: 'medium',
              details: {
                type: thrashingType,
                tokensBefore,
                tokensAfter,
                payloadSize,
                windowCapacity,
                windowThreshold,
                compressionDelay,
                reusedWithinLookahead,
                payloadFootprint: this.codeContext.summarizeFootprint(payloadFootprint),
                windowUsage: (tokensAfter / this.config.contextWindowSize * 100).toFixed(1) + '%',
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
   * Find the compression delay
   */
  private findCompressionDelay(nextSteps: MessageNode[]): number {
    for (let i = 0; i < nextSteps.length; i++) {
      const message = nextSteps[i];

      // Check whether there is a content-replacement
      const replacements: ContentReplacementRecord[] = [];
      for (const replacement of this.sessionData.replacements.values()) {
        if (replacement.messageId === message.messageId) {
          replacements.push(replacement);
        }
      }

      if (replacements.length > 0) {
        return i + 1; // Return the number of steps
      }

      // Check whether token usage drops sharply (indicating that compression occurred)
      if (i > 0 && message.usage) {
        const prevMessage = nextSteps[i - 1];

        if (prevMessage.usage) {
          const currentTotal = message.usage.input_tokens + message.usage.output_tokens;
          const prevTotal = prevMessage.usage.input_tokens + prevMessage.usage.output_tokens;

          // If the token count drops by more than 20%
          if (currentTotal < prevTotal * 0.8) {
            return i + 1;
          }
        }
      }
    }

    return -1; // No compression found
  }

  private getPayloadFootprint(message: MessageNode): CodeFootprint {
    return this.codeContext.getMessageFootprint(message);
  }

  private hasFootprintReuse(footprint: CodeFootprint, messages: MessageNode[]): boolean {
    if (
      footprint.directFiles.size === 0 &&
      footprint.strongRelatedFiles.size === 0 &&
      footprint.weakRelatedFiles.size === 0 &&
      footprint.symbols.size === 0
    ) {
      return false;
    }

    return messages.some((message) => {
      const nextFootprint = this.codeContext.getMessageFootprint(message);
      return this.codeContext.hasMeaningfulOverlap(footprint, nextFootprint, 0.2);
    });
  }
}
