/**
 * JSONL Entry Types - 22 combinations based on Claude Code session storage
 */

// Base Entry Types (supports both legacy and real-world formats)
export type EntryType = 
  | 'message'
  | 'attachment'
  | 'metadata'
  | 'tool-use'
  | 'tool-result'
  | 'content-replacement'
  | 'user'
  | 'assistant'
  | 'system'
  | 'file-history-snapshot'
  | 'progress';

// Message Types
export type MessageType = 'user' | 'assistant' | 'attachment' | 'system';

// Metadata Types
export type MetadataType = 
  | 'custom-title'
  | 'ai-title'
  | 'tag'
  | 'agent-name'
  | 'mode'
  | 'worktree-state'
  | 'pr-link';

// Content Block Types
export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  source: {
    type: 'base64' | 'url';
    media_type: string;
    data?: string;
    url?: string;
  };
}

export interface ToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, any>;
}

export interface ToolResultContent {
  type: 'tool_result';
  tool_use_id: string;
  content?: string | Array<TextContent | ImageContent>;
  is_error?: boolean;
}

export type ContentBlock = TextContent | ImageContent | ToolUseContent | ToolResultContent;

// JSONL Entry Definitions (22 types)
export interface BaseEntry {
  uuid: string;
  timestamp: number;
}

// 1. User Message Entry
export interface UserMessageEntry extends BaseEntry {
  type: 'message';
  message: {
    type: 'user';
    id: string;
    content: ContentBlock[];
    parentUuid?: string;
    agentId?: string;
    isSidechain?: boolean;
  };
}

// 2. Assistant Message Entry
export interface AssistantMessageEntry extends BaseEntry {
  type: 'message';
  message: {
    type: 'assistant';
    id: string;
    content: ContentBlock[];
    parentUuid?: string;
    agentId?: string;
    isSidechain?: boolean;
    model?: string;
    stop_reason?: string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
    };
  };
}

// 3. Attachment Message Entry
export interface AttachmentMessageEntry extends BaseEntry {
  type: 'message';
  message: {
    type: 'attachment';
    id: string;
    content: ContentBlock[];
    parentUuid?: string;
  };
}

// 4. System Message Entry
export interface SystemMessageEntry extends BaseEntry {
  type: 'message';
  message: {
    type: 'system';
    id: string;
    content: ContentBlock[];
    parentUuid?: string;
  };
}

// 5. Attachment Entry
export interface AttachmentEntry extends BaseEntry {
  type: 'attachment';
  attachment: {
    name: string;
    path?: string;
    content?: string;
    mimeType?: string;
    size?: number;
  };
}

// 6-12. Metadata Entries
export interface CustomTitleMetadataEntry extends BaseEntry {
  type: 'metadata';
  metadata: {
    type: 'custom-title';
    title: string;
  };
}

export interface AiTitleMetadataEntry extends BaseEntry {
  type: 'metadata';
  metadata: {
    type: 'ai-title';
    title: string;
  };
}

export interface TagMetadataEntry extends BaseEntry {
  type: 'metadata';
  metadata: {
    type: 'tag';
    tags: string[];
  };
}

export interface AgentNameMetadataEntry extends BaseEntry {
  type: 'metadata';
  metadata: {
    type: 'agent-name';
    agentId: string;
    name: string;
  };
}

export interface ModeMetadataEntry extends BaseEntry {
  type: 'metadata';
  metadata: {
    type: 'mode';
    mode: 'plan' | 'act';
  };
}

export interface WorktreeStateMetadataEntry extends BaseEntry {
  type: 'metadata';
  metadata: {
    type: 'worktree-state';
    state: Record<string, any>;
  };
}

export interface PrLinkMetadataEntry extends BaseEntry {
  type: 'metadata';
  metadata: {
    type: 'pr-link';
    url: string;
    number: number;
  };
}

export type MetadataEntry = 
  | CustomTitleMetadataEntry
  | AiTitleMetadataEntry
  | TagMetadataEntry
  | AgentNameMetadataEntry
  | ModeMetadataEntry
  | WorktreeStateMetadataEntry
  | PrLinkMetadataEntry;

// 13. Tool Use Entry
export interface ToolUseEntry extends BaseEntry {
  type: 'tool-use';
  toolUse: {
    id: string;
    name: string;
    input: Record<string, any>;
    messageId: string;
    agentId?: string;
  };
}

// 14. Tool Result Entry
export interface ToolResultEntry extends BaseEntry {
  type: 'tool-result';
  toolResult: {
    tool_use_id: string;
    content?: string | Array<TextContent | ImageContent>;
    is_error?: boolean;
    messageId: string;
  };
}

// 15. Content Replacement Entry
export interface ContentReplacementEntry extends BaseEntry {
  type: 'content-replacement';
  replacement: {
    messageId: string;
    toolUseId: string;
    originalContent: string;
    replacementContent: string;
    reason?: string;
  };
}

// Real-world JSONL entry types (from actual Claude Code sessions)
export interface RealWorldUserEntry {
  type: 'user';
  uuid: string;
  timestamp: number;
  parentUuid?: string | null;
  agentId?: string;
  isSidechain?: boolean;
  message: {
    role: 'user';
    content: string | Array<any>;
    id?: string;
  };
}

export interface RealWorldAssistantEntry {
  type: 'assistant';
  uuid: string;
  timestamp: number;
  parentUuid?: string | null;
  agentId?: string;
  isSidechain?: boolean;
  message: {
    role: 'assistant';
    content: string | Array<any>;
    id: string;
    model?: string;
    stop_reason?: string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
    };
  };
}

export interface RealWorldSystemEntry {
  type: 'system';
  uuid: string;
  timestamp: number;
  parentUuid?: string | null;
  message: {
    role: 'system';
    content: string | Array<any>;
    id?: string;
  };
}

export interface FileHistorySnapshotEntry {
  type: 'file-history-snapshot';
  messageId: string;
  timestamp: number;
  [key: string]: any;
}

export interface ProgressEntry {
  type: 'progress';
  timestamp: number;
  [key: string]: any;
}

// Union type for all entries (legacy + real-world formats)
export type JsonlEntry = 
  | UserMessageEntry
  | AssistantMessageEntry
  | AttachmentMessageEntry
  | SystemMessageEntry
  | AttachmentEntry
  | MetadataEntry
  | ToolUseEntry
  | ToolResultEntry
  | ContentReplacementEntry
  | RealWorldUserEntry
  | RealWorldAssistantEntry
  | RealWorldSystemEntry
  | FileHistorySnapshotEntry
  | ProgressEntry;

/**
 * Parsed Data Structures
 */

// Message Node - represents a single message with all its information
export interface MessageNode {
  uuid: string;
  messageId: string;
  type: MessageType;
  timestamp: number;
  content: string | ContentBlock[]; // Support both string and array formats
  parentUuid?: string | null;
  agentId?: string;
  isSidechain?: boolean;
  model?: string;
  stop_reason?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  children: string[]; // child message uuids
  toolUses: ToolUseInfo[];
  toolResults: ToolResultInfo[];
  replacements: ContentReplacementRecord[];
}

// Agent Information
export interface AgentInfo {
  agentId: string;
  name?: string;
  messageUuids: string[];
  toolUseCount: number;
  createdAt: number;
}

// Branch Tree Structure
export interface BranchNode {
  agentId: string;
  name?: string;
  parentAgentId?: string;
  messageUuids: string[];
  children: string[]; // child agent IDs
  depth: number;
}

export interface BranchTree {
  mainBranch: BranchNode;
  branches: Map<string, BranchNode>;
}

// Tool Information
export interface ToolUseInfo {
  id: string;
  name: string;
  input: Record<string, any>;
  timestamp: number;
  messageId: string;
  messageUuid: string;
  agentId?: string;
  hasResult: boolean;
  resultUuid?: string;
}

export interface ToolResultInfo {
  tool_use_id: string;
  content?: string | Array<TextContent | ImageContent>;
  is_error?: boolean;
  timestamp: number;
  messageId: string;
  messageUuid: string;
}

// Content Replacement
export interface ContentReplacementRecord {
  uuid: string;
  timestamp: number;
  messageId: string;
  toolUseId: string;
  originalContent: string;
  replacementContent: string;
  reason?: string;
}

// Timeline Event
export interface TimelineEvent {
  uuid: string;
  timestamp: number;
  type: 'message' | 'tool-use' | 'tool-result' | 'metadata' | 'replacement';
  messageType?: MessageType;
  agentId?: string;
  isSidechain?: boolean;
  description: string;
}

// Session Statistics
export interface SessionStatistics {
  totalMessages: number;
  messagesByType: Record<MessageType, number>;
  totalToolUses: number;
  toolUsesByName: Record<string, number>;
  totalAgents: number;
  totalBranches: number;
  totalReplacements: number;
  totalTokens: {
    input: number;
    output: number;
  };
  timeRange: {
    start: number;
    end: number;
    duration: number;
  };
}

/**
 * Main Session Data Class
 */
export interface SessionData {
  // Core data
  messages: Map<string, MessageNode>;
  messagesByMessageId: Map<string, string[]>; // messageId -> uuids[]
  agents: Map<string, AgentInfo>;
  branchTree: BranchTree;
  toolUses: Map<string, ToolUseInfo>;
  toolResults: Map<string, ToolResultInfo>;
  replacements: Map<string, ContentReplacementRecord>;
  
  // Metadata
  title?: string;
  tags: string[];
  mode?: 'plan' | 'act';
  prLinks: Array<{ url: string; number: number; timestamp: number }>;
  
  // Timeline
  timeline: TimelineEvent[];
  
  // Statistics
  statistics: SessionStatistics;
}

/**
 * Query Result Types
 */
export interface ConversationChain {
  messages: MessageNode[];
  depth: number;
}

export interface StreamFragment {
  uuid: string;
  messageId: string;
  timestamp: number;
  content: ContentBlock[];
  fragmentIndex: number;
}

export interface MergedStreamMessage {
  messageId: string;
  fragments: StreamFragment[];
  mergedContent: ContentBlock[];
  totalFragments: number;
}

/**
 * Export Format Types
 */
export interface GraphNode {
  id: string;
  label: string;
  type: 'message' | 'agent' | 'tool';
  data: any;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: 'parent-child' | 'tool-use' | 'tool-result' | 'branch';
  label?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Analysis Result Types
 */
export interface ConversationFlow {
  mainBranchFlow: {
    messageCount: number;
    averageResponseTime: number;
    toolUsageRate: number;
  };
  branchFlows: Array<{
    agentId: string;
    name?: string;
    messageCount: number;
    toolUsageRate: number;
    mergedToMain: boolean;
  }>;
}

export interface ToolUsagePattern {
  toolName: string;
  usageCount: number;
  successRate: number;
  averageExecutionTime: number;
  commonInputPatterns: Array<{
    pattern: string;
    count: number;
  }>;
  errorPatterns: Array<{
    error: string;
    count: number;
  }>;
}

export interface BranchUsageAnalysis {
  totalBranches: number;
  averageBranchDepth: number;
  branchMergeRate: number;
  branchDetails: Array<{
    agentId: string;
    name?: string;
    depth: number;
    messageCount: number;
    toolUseCount: number;
    merged: boolean;
  }>;
}

export interface ReplacementPattern {
  toolName: string;
  replacementCount: number;
  averageReplacementSize: number;
  commonReasons: Array<{
    reason: string;
    count: number;
  }>;
}