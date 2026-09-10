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
 * 上下文窗口抖动检测器
 * 检测刚读取大量信息便立即压缩，信息未充分利用
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

    // 获取所有消息按时间排序
    const messages = Array.from(this.sessionData.messages.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];

      // 计算此步骤前后的上下文token数
      const { tokensBefore, tokensAfter } = this.contextChains.getContextTokenStats(message.uuid);

      // 检查是否接近窗口上限
      const windowThreshold = this.config.contextWindowSize * this.config.thresholds.thrashing.windowThreshold;

      // 预警：接近窗口阈值（75%）前的边界
      if (tokensAfter > windowThreshold * 0.95) {
        writePrewarn({
          metric: 'contextThrashing',
          message: `上下文使用接近阈值: ${(tokensAfter / this.config.contextWindowSize * 100).toFixed(1)}%`,
          details: { step: i, tokensAfter },
        });
      }
      if (tokensAfter > windowThreshold) {
        // 检查后续步骤是否有压缩
        const nextSteps = this.contextChains.getFutureContextMessages(
          message.uuid,
          this.config.thresholds.thrashing.compressionLookAhead
        );
        const compressionDelay = this.findCompressionDelay(nextSteps);

        if (compressionDelay >= 0) {
          // 发现了抖动
          const payloadSize = tokensAfter - tokensBefore;
          const windowCapacity = this.config.contextWindowSize - tokensBefore;
          const payloadFootprint = this.getPayloadFootprint(message);
          const messagesBeforeCompression = nextSteps.slice(0, Math.max(compressionDelay - 1, 0));
          const reusedBeforeCompression = this.hasFootprintReuse(payloadFootprint, messagesBeforeCompression);
          const reusedWithinLookahead = this.hasFootprintReuse(payloadFootprint, nextSteps);

          if (reusedBeforeCompression) {
            continue;
          }

          // 判断类型
          let thrashingType: 'timing_fault' | 'payload_oversize_fault';
          let severity: Severity;

          if (payloadSize < windowCapacity * 0.5) {
            // Timing Fault: 压缩时机太晚
            thrashingType = 'timing_fault';
            severity = Severity.Warning;
          } else {
            // Payload Oversize Fault: 单个对象过大
            thrashingType = 'payload_oversize_fault';
            severity = Severity.Warning;
          }

          const deduction = 1.0;

          issues.push({
            metric: 'contextThrashing',
            severity,
            message: `检测到上下文窗口抖动 (${thrashingType}): 步骤${i}添加${payloadSize} tokens后，在${compressionDelay}步后触发压缩`,
            location: {
              stepRange: [i, i + compressionDelay],
              messageUuid: message.uuid,
            },
            suggestion: thrashingType === 'timing_fault'
              ? `应在接近窗口上限前及时压缩，避免突发性超限`
              : `单次添加的内容过大 (${payloadSize} tokens)，考虑分批处理或提前摘要`,
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
   * 查找压缩延迟
   */
  private findCompressionDelay(nextSteps: MessageNode[]): number {
    for (let i = 0; i < nextSteps.length; i++) {
      const message = nextSteps[i];

      // 检查是否有content-replacement
      const replacements: ContentReplacementRecord[] = [];
      for (const replacement of this.sessionData.replacements.values()) {
        if (replacement.messageId === message.messageId) {
          replacements.push(replacement);
        }
      }

      if (replacements.length > 0) {
        return i + 1; // 返回步骤数
      }

      // 检查token使用是否突然下降（表示压缩发生）
      if (i > 0 && message.usage) {
        const prevMessage = nextSteps[i - 1];

        if (prevMessage.usage) {
          const currentTotal = message.usage.input_tokens + message.usage.output_tokens;
          const prevTotal = prevMessage.usage.input_tokens + prevMessage.usage.output_tokens;

          // 如果token数下降超过20%
          if (currentTotal < prevTotal * 0.8) {
            return i + 1;
          }
        }
      }
    }

    return -1; // 未发现压缩
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
