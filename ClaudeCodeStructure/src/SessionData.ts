import {
  SessionData,
  MessageNode,
  AgentInfo,
  BranchTree,
  BranchNode,
  ToolUseInfo,
  ToolResultInfo,
  ContentReplacementRecord,
  TimelineEvent,
  SessionStatistics,
  MessageType,
} from './types';

/**
 * SessionData class - Main data container for parsed JSONL session data
 */
export class SessionDataImpl implements SessionData {
  messages: Map<string, MessageNode>;
  messagesByMessageId: Map<string, string[]>;
  agents: Map<string, AgentInfo>;
  branchTree: BranchTree;
  toolUses: Map<string, ToolUseInfo>;
  toolResults: Map<string, ToolResultInfo>;
  replacements: Map<string, ContentReplacementRecord>;
  
  title?: string;
  tags: string[];
  mode?: 'plan' | 'act';
  prLinks: Array<{ url: string; number: number; timestamp: number }>;
  
  timeline: TimelineEvent[];
  statistics: SessionStatistics;

  constructor() {
    this.messages = new Map();
    this.messagesByMessageId = new Map();
    this.agents = new Map();
    this.branchTree = {
      mainBranch: {
        agentId: 'main',
        messageUuids: [],
        children: [],
        depth: 0,
      },
      branches: new Map(),
    };
    this.toolUses = new Map();
    this.toolResults = new Map();
    this.replacements = new Map();
    
    this.tags = [];
    this.prLinks = [];
    this.timeline = [];
    
    this.statistics = {
      totalMessages: 0,
      messagesByType: {
        user: 0,
        assistant: 0,
        attachment: 0,
        system: 0,
      },
      totalToolUses: 0,
      toolUsesByName: {},
      totalAgents: 0,
      totalBranches: 0,
      totalReplacements: 0,
      totalTokens: {
        input: 0,
        output: 0,
      },
      timeRange: {
        start: 0,
        end: 0,
        duration: 0,
      },
    };
  }

  /**
   * Add a message node to the session
   */
  addMessage(message: MessageNode): void {
    this.messages.set(message.uuid, message);
    
    // Track by message ID for stream fragment grouping
    if (!this.messagesByMessageId.has(message.messageId)) {
      this.messagesByMessageId.set(message.messageId, []);
    }
    this.messagesByMessageId.get(message.messageId)!.push(message.uuid);
    
    // Update statistics
    this.statistics.totalMessages++;
    this.statistics.messagesByType[message.type]++;
    
    if (message.usage) {
      this.statistics.totalTokens.input += message.usage.input_tokens;
      this.statistics.totalTokens.output += message.usage.output_tokens;
    }
    
    // Update time range
    if (this.statistics.timeRange.start === 0 || message.timestamp < this.statistics.timeRange.start) {
      this.statistics.timeRange.start = message.timestamp;
    }
    if (message.timestamp > this.statistics.timeRange.end) {
      this.statistics.timeRange.end = message.timestamp;
    }
    this.statistics.timeRange.duration = this.statistics.timeRange.end - this.statistics.timeRange.start;
    
    // Add to timeline
    this.timeline.push({
      uuid: message.uuid,
      timestamp: message.timestamp,
      type: 'message',
      messageType: message.type,
      agentId: message.agentId,
      isSidechain: message.isSidechain,
      description: `${message.type} message`,
    });
  }

  /**
   * Add an agent to the session
   */
  addAgent(agent: AgentInfo): void {
    this.agents.set(agent.agentId, agent);
    this.statistics.totalAgents++;
  }

  /**
   * Add a tool use to the session
   */
  addToolUse(toolUse: ToolUseInfo): void {
    this.toolUses.set(toolUse.id, toolUse);
    
    // Update statistics
    this.statistics.totalToolUses++;
    if (!this.statistics.toolUsesByName[toolUse.name]) {
      this.statistics.toolUsesByName[toolUse.name] = 0;
    }
    this.statistics.toolUsesByName[toolUse.name]++;
    
    // Add to timeline
    this.timeline.push({
      uuid: toolUse.id,
      timestamp: toolUse.timestamp,
      type: 'tool-use',
      agentId: toolUse.agentId,
      description: `Tool use: ${toolUse.name}`,
    });
  }

  /**
   * Add a tool result to the session
   */
  addToolResult(toolResult: ToolResultInfo): void {
    this.toolResults.set(toolResult.tool_use_id, toolResult);
    
    // Link to tool use
    const toolUse = this.toolUses.get(toolResult.tool_use_id);
    if (toolUse) {
      toolUse.hasResult = true;
      toolUse.resultUuid = toolResult.messageUuid;
    }
    
    // Add to timeline
    this.timeline.push({
      uuid: toolResult.tool_use_id,
      timestamp: toolResult.timestamp,
      type: 'tool-result',
      description: `Tool result: ${toolResult.is_error ? 'error' : 'success'}`,
    });
  }

  /**
   * Add a content replacement to the session
   */
  addReplacement(replacement: ContentReplacementRecord): void {
    this.replacements.set(replacement.uuid, replacement);
    this.statistics.totalReplacements++;
    
    // Add to timeline
    this.timeline.push({
      uuid: replacement.uuid,
      timestamp: replacement.timestamp,
      type: 'replacement',
      description: `Content replacement for tool ${replacement.toolUseId}`,
    });
  }

  /**
   * Build parent-child relationships between messages
   */
  buildMessageRelationships(): void {
    for (const message of this.messages.values()) {
      if (message.parentUuid) {
        const parent = this.messages.get(message.parentUuid);
        if (parent) {
          parent.children.push(message.uuid);
        }
      }
    }
  }

  /**
   * Build branch tree structure
   */
  buildBranchTree(): void {
    const agentMap = new Map<string, BranchNode>();
    
    // Create nodes for all agents
    for (const agent of this.agents.values()) {
      const node: BranchNode = {
        agentId: agent.agentId,
        name: agent.name,
        messageUuids: agent.messageUuids,
        children: [],
        depth: 0,
      };
      agentMap.set(agent.agentId, node);
    }
    
    // Build tree structure based on message relationships
    for (const message of this.messages.values()) {
      if (message.agentId && message.isSidechain) {
        const agentNode = agentMap.get(message.agentId);
        if (agentNode && message.parentUuid) {
          const parentMessage = this.messages.get(message.parentUuid);
          if (parentMessage) {
            const parentAgentId = parentMessage.agentId || 'main';
            agentNode.parentAgentId = parentAgentId;
            
            if (parentAgentId === 'main') {
              this.branchTree.mainBranch.children.push(message.agentId);
              agentNode.depth = 1;
            } else {
              const parentNode = agentMap.get(parentAgentId);
              if (parentNode) {
                parentNode.children.push(message.agentId);
                agentNode.depth = parentNode.depth + 1;
              }
            }
          }
        }
      } else if (!message.agentId || !message.isSidechain) {
        // Main branch message
        this.branchTree.mainBranch.messageUuids.push(message.uuid);
      }
    }
    
    // Add all branch nodes to the tree
    for (const [agentId, node] of agentMap) {
      this.branchTree.branches.set(agentId, node);
    }
    
    this.statistics.totalBranches = agentMap.size;
  }

  /**
   * Sort timeline by timestamp
   */
  sortTimeline(): void {
    this.timeline.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get a message by UUID
   */
  getMessage(uuid: string): MessageNode | undefined {
    return this.messages.get(uuid);
  }

  /**
   * Get all messages with a specific message ID (stream fragments)
   */
  getMessagesByMessageId(messageId: string): MessageNode[] {
    const uuids = this.messagesByMessageId.get(messageId) || [];
    return uuids.map(uuid => this.messages.get(uuid)!).filter(Boolean);
  }

  /**
   * Get an agent by ID
   */
  getAgent(agentId: string): AgentInfo | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get a tool use by ID
   */
  getToolUse(toolUseId: string): ToolUseInfo | undefined {
    return this.toolUses.get(toolUseId);
  }

  /**
   * Get a tool result by tool use ID
   */
  getToolResult(toolUseId: string): ToolResultInfo | undefined {
    return this.toolResults.get(toolUseId);
  }

  /**
   * Get all replacements for a message
   */
  getReplacementsForMessage(messageId: string): ContentReplacementRecord[] {
    return Array.from(this.replacements.values())
      .filter(r => r.messageId === messageId);
  }

  /**
   * Get all messages in chronological order
   */
  getTimelineMessages(): MessageNode[] {
    return Array.from(this.messages.values())
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get summary of the session
   */
  getSummary(): string {
    return `Session Summary:
- Total Messages: ${this.statistics.totalMessages}
  - User: ${this.statistics.messagesByType.user}
  - Assistant: ${this.statistics.messagesByType.assistant}
  - System: ${this.statistics.messagesByType.system}
  - Attachment: ${this.statistics.messagesByType.attachment}
- Total Tool Uses: ${this.statistics.totalToolUses}
- Total Agents: ${this.statistics.totalAgents}
- Total Branches: ${this.statistics.totalBranches}
- Total Replacements: ${this.statistics.totalReplacements}
- Total Tokens: ${this.statistics.totalTokens.input + this.statistics.totalTokens.output}
  - Input: ${this.statistics.totalTokens.input}
  - Output: ${this.statistics.totalTokens.output}
- Duration: ${Math.round(this.statistics.timeRange.duration / 1000)}s
- Title: ${this.title || 'Untitled'}
- Tags: ${this.tags.join(', ') || 'None'}
- Mode: ${this.mode || 'Unknown'}`;
  }
}