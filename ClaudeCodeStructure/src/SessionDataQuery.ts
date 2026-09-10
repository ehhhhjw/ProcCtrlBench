import {
  MessageNode,
  ConversationChain,
  StreamFragment,
  MergedStreamMessage,
  ContentBlock,
  TextContent,
} from './types';
import { SessionDataImpl } from './SessionData';

/**
 * SessionDataQuery - Query interface for session data
 */
export class SessionDataQuery {
  constructor(private sessionData: SessionDataImpl) {}

  /**
   * Get all messages from the main branch (not sidechains)
   */
  getMainBranchMessages(): MessageNode[] {
    return this.sessionData.branchTree.mainBranch.messageUuids
      .map(uuid => this.sessionData.getMessage(uuid)!)
      .filter(Boolean)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get all messages from a specific agent/branch
   */
  getAgentMessages(agentId: string): MessageNode[] {
    const agent = this.sessionData.getAgent(agentId);
    if (!agent) return [];

    return agent.messageUuids
      .map(uuid => this.sessionData.getMessage(uuid)!)
      .filter(Boolean)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get conversation chain starting from a message
   */
  getConversationChain(startUuid: string): ConversationChain {
    const messages: MessageNode[] = [];
    let current = this.sessionData.getMessage(startUuid);
    let depth = 0;

    while (current) {
      messages.unshift(current);
      depth++;
      current = current.parentUuid ? this.sessionData.getMessage(current.parentUuid) : undefined;
    }

    return { messages, depth };
  }

  /**
   * Get all stream fragments for a message ID
   */
  getStreamFragments(messageId: string): StreamFragment[] {
    const messages = this.sessionData.getMessagesByMessageId(messageId);
    
    return messages
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((msg, index) => ({
        uuid: msg.uuid,
        messageId: msg.messageId,
        timestamp: msg.timestamp,
        content: Array.isArray(msg.content) ? msg.content : [{ type: 'text' as const, text: msg.content }],
        fragmentIndex: index,
      }));
  }

  /**
   * Merge stream fragments into a single message
   */
  mergeStreamFragments(messageId: string): MergedStreamMessage {
    const fragments = this.getStreamFragments(messageId);
    const mergedContent: ContentBlock[] = [];

    // Merge content blocks from all fragments
    for (const fragment of fragments) {
      for (const block of fragment.content) {
        if (block.type === 'text') {
          // Merge text blocks
          const lastBlock = mergedContent[mergedContent.length - 1];
          if (lastBlock && lastBlock.type === 'text') {
            lastBlock.text += block.text;
          } else {
            mergedContent.push({ ...block });
          }
        } else {
          // Add non-text blocks as-is
          mergedContent.push(block);
        }
      }
    }

    return {
      messageId,
      fragments,
      mergedContent,
      totalFragments: fragments.length,
    };
  }

  /**
   * Get tool result for a specific tool use
   */
  getToolResult(toolUseId: string) {
    return this.sessionData.getToolResult(toolUseId);
  }

  /**
   * Get content replacement for a tool use
   */
  getToolReplacement(toolUseId: string) {
    return Array.from(this.sessionData.replacements.values())
      .find(r => r.toolUseId === toolUseId);
  }

  /**
   * Get all messages that use a specific tool
   */
  getMessagesUsingTool(toolName: string): MessageNode[] {
    const messages: MessageNode[] = [];
    
    for (const toolUse of this.sessionData.toolUses.values()) {
      if (toolUse.name === toolName) {
        const msgs = this.sessionData.getMessagesByMessageId(toolUse.messageId);
        messages.push(...msgs);
      }
    }

    return Array.from(new Set(messages))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get all branches (agents) in the session
   */
  getAllBranches() {
    return Array.from(this.sessionData.agents.values())
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Get branch tree structure
   */
  getBranchTree() {
    return this.sessionData.branchTree;
  }

  /**
   * Check if a branch was merged to main
   */
  isBranchMergedToMain(agentId: string): boolean {
    const agent = this.sessionData.getAgent(agentId);
    if (!agent) return false;

    // Check if any message from this agent has children in the main branch
    for (const uuid of agent.messageUuids) {
      const message = this.sessionData.getMessage(uuid);
      if (message && message.children.length > 0) {
        for (const childUuid of message.children) {
          const child = this.sessionData.getMessage(childUuid);
          if (child && (!child.agentId || !child.isSidechain)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Get all tool uses in chronological order
   */
  getAllToolUses() {
    return Array.from(this.sessionData.toolUses.values())
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get tool uses by name
   */
  getToolUsesByName(toolName: string) {
    return Array.from(this.sessionData.toolUses.values())
      .filter(t => t.name === toolName)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get session statistics
   */
  getStatistics() {
    return this.sessionData.statistics;
  }

  /**
   * Get session timeline
   */
  getTimeline() {
    return this.sessionData.timeline;
  }

  /**
   * Search messages by content
   */
  searchMessages(query: string): MessageNode[] {
    const results: MessageNode[] = [];
    const lowerQuery = query.toLowerCase();

    for (const message of this.sessionData.messages.values()) {
      const contentBlocks = Array.isArray(message.content) 
        ? message.content 
        : [{ type: 'text' as const, text: message.content }];
      
      for (const block of contentBlocks) {
        if (block.type === 'text' && block.text.toLowerCase().includes(lowerQuery)) {
          results.push(message);
          break;
        }
      }
    }

    return results.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get messages by type
   */
  getMessagesByType(type: 'user' | 'assistant' | 'system' | 'attachment'): MessageNode[] {
    return Array.from(this.sessionData.messages.values())
      .filter(m => m.type === type)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get messages in a time range
   */
  getMessagesInTimeRange(startTime: number, endTime: number): MessageNode[] {
    return Array.from(this.sessionData.messages.values())
      .filter(m => m.timestamp >= startTime && m.timestamp <= endTime)
      .sort((a, b) => a.timestamp - b.timestamp);
  }
}