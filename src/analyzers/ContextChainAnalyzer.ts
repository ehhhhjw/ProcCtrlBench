import { SessionData, MessageNode } from '../../ClaudeCodeStructure/src/types';
import {
  ContextChainAnalysisSummary,
  ContextChainStepAnalysis,
} from '../types/evaluation.types';

interface DescendantOptions {
  includeSelf?: boolean;
  limit?: number;
}

/**
 * ContextChainAnalyzer
 * Builds root-to-message chains so detectors can reason about the
 * actual runtime context of each execution step instead of using
 * coarse chronological windows.
 */
export class ContextChainAnalyzer {
  private sessionData: SessionData;
  private chainCache = new Map<string, string[]>();
  private descendantsCache = new Map<string, MessageNode[]>();
  private parentToChildren = new Map<string, string[]>();

  constructor(sessionData: SessionData) {
    this.sessionData = sessionData;
    this.buildParentIndex();
  }

  getChainUuids(messageUuid: string): string[] {
    if (this.chainCache.has(messageUuid)) {
      return this.chainCache.get(messageUuid)!;
    }

    const chain: string[] = [];
    const visited = new Set<string>();
    let currentUuid: string | null | undefined = messageUuid;

    while (currentUuid && !visited.has(currentUuid)) {
      const message = this.sessionData.messages.get(currentUuid);
      if (!message) {
        break;
      }

      visited.add(currentUuid);
      chain.unshift(currentUuid);
      currentUuid = message.parentUuid || undefined;
    }

    this.chainCache.set(messageUuid, chain);
    return chain;
  }

  getChainMessages(messageUuid: string): MessageNode[] {
    return this.getChainUuids(messageUuid)
      .map((uuid) => this.sessionData.messages.get(uuid))
      .filter((message): message is MessageNode => message !== undefined);
  }

  getContextTokenStats(messageUuid: string): { tokensBefore: number; tokensAfter: number } {
    const chainMessages = this.getChainMessages(messageUuid);
    if (chainMessages.length === 0) {
      return { tokensBefore: 0, tokensAfter: 0 };
    }

    let tokensBefore = 0;
    for (let i = 0; i < chainMessages.length - 1; i++) {
      tokensBefore += this.getMessageTokens(chainMessages[i]);
    }

    const tokensAfter = tokensBefore + this.getMessageTokens(chainMessages[chainMessages.length - 1]);
    return { tokensBefore, tokensAfter };
  }

  getFutureContextMessages(messageUuid: string, limit?: number): MessageNode[] {
    return this.getDescendantMessages(messageUuid, {
      includeSelf: false,
      limit,
    });
  }

  buildStepAnalyses(): ContextChainStepAnalysis[] {
    const messages = Array.from(this.sessionData.messages.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    return messages.map((message) => {
      const { tokensBefore, tokensAfter } = this.getContextTokenStats(message.uuid);
      const chainUuids = this.getChainUuids(message.uuid);

      return {
        messageUuid: message.uuid,
        messageId: message.messageId,
        parentUuid: message.parentUuid || null,
        timestamp: message.timestamp,
        type: message.type,
        agentId: message.agentId,
        isSidechain: message.isSidechain,
        chainUuids,
        chainLength: chainUuids.length,
        contextTokensBefore: tokensBefore,
        contextTokensAfter: tokensAfter,
      };
    });
  }

  buildContextChainMap(): Record<string, string[]> {
    const messages = Array.from(this.sessionData.messages.values())
      .sort((a, b) => a.timestamp - b.timestamp);
    const contextChains: Record<string, string[]> = {};

    for (const message of messages) {
      contextChains[message.uuid] = this.getChainUuids(message.uuid);
    }

    return contextChains;
  }

  buildSummary(): ContextChainAnalysisSummary {
    const stepAnalyses = this.buildStepAnalyses();
    if (stepAnalyses.length === 0) {
      return {
        enabled: true,
        analyzedSteps: 0,
        averageChainLength: 0,
        maxChainLength: 0,
        averageContextTokensBefore: 0,
        maxContextTokensBefore: 0,
      };
    }

    const totalChainLength = stepAnalyses.reduce((sum, step) => sum + step.chainLength, 0);
    const totalTokensBefore = stepAnalyses.reduce((sum, step) => sum + step.contextTokensBefore, 0);

    return {
      enabled: true,
      analyzedSteps: stepAnalyses.length,
      averageChainLength: totalChainLength / stepAnalyses.length,
      maxChainLength: Math.max(...stepAnalyses.map((step) => step.chainLength)),
      averageContextTokensBefore: totalTokensBefore / stepAnalyses.length,
      maxContextTokensBefore: Math.max(...stepAnalyses.map((step) => step.contextTokensBefore)),
    };
  }

  getDescendantMessages(messageUuid: string, options: DescendantOptions = {}): MessageNode[] {
    const includeSelf = options.includeSelf || false;
    const limit = options.limit;

    if (!this.descendantsCache.has(messageUuid)) {
      const descendants: MessageNode[] = [];
      const queue = [...(this.parentToChildren.get(messageUuid) || [])];
      const visited = new Set<string>();

      while (queue.length > 0) {
        const currentUuid = queue.shift()!;
        if (visited.has(currentUuid)) {
          continue;
        }
        visited.add(currentUuid);

        const message = this.sessionData.messages.get(currentUuid);
        if (message) {
          descendants.push(message);
        }

        const children = this.parentToChildren.get(currentUuid) || [];
        queue.push(...children);
      }

      descendants.sort((a, b) => a.timestamp - b.timestamp);
      this.descendantsCache.set(messageUuid, descendants);
    }

    const descendants = [...(this.descendantsCache.get(messageUuid) || [])];
    if (includeSelf) {
      const message = this.sessionData.messages.get(messageUuid);
      if (message) {
        descendants.unshift(message);
      }
    }

    if (typeof limit === 'number') {
      return descendants.slice(0, limit);
    }
    return descendants;
  }

  isDescendant(messageUuid: string, ancestorUuid: string): boolean {
    if (messageUuid === ancestorUuid) {
      return false;
    }
    return this.getChainUuids(messageUuid).includes(ancestorUuid);
  }

  private buildParentIndex(): void {
    for (const message of this.sessionData.messages.values()) {
      if (!message.parentUuid) {
        continue;
      }

      if (!this.parentToChildren.has(message.parentUuid)) {
        this.parentToChildren.set(message.parentUuid, []);
      }

      this.parentToChildren.get(message.parentUuid)!.push(message.uuid);
    }

    for (const [parentUuid, childUuids] of this.parentToChildren.entries()) {
      childUuids.sort((a, b) => {
        const left = this.sessionData.messages.get(a)?.timestamp || 0;
        const right = this.sessionData.messages.get(b)?.timestamp || 0;
        return left - right;
      });
      this.parentToChildren.set(parentUuid, childUuids);
    }
  }

  private getMessageTokens(message: MessageNode): number {
    if (!message.usage) {
      return 0;
    }
    return message.usage.input_tokens + message.usage.output_tokens;
  }
}
