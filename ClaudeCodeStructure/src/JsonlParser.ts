import * as fs from 'fs';
import * as readline from 'readline';
import {
  JsonlEntry,
  MessageNode,
  AgentInfo,
  ToolUseInfo,
  ToolResultInfo,
  ContentReplacementRecord,
  ContentBlock,
  MessageType,
} from './types';
import { SessionDataImpl } from './SessionData';

/**
 * JsonlParser - Three-pass parser for JSONL session files
 * 
 * Pass 1: Collect all entries
 * Pass 2: Build relationships (parent-child, tool-use-result, etc.)
 * Pass 3: Calculate statistics and build indexes
 */
export class JsonlParser {
  private entries: JsonlEntry[] = [];
  private sessionData: SessionDataImpl;

  constructor() {
    this.sessionData = new SessionDataImpl();
  }

  /**
   * Parse a JSONL file
   */
  async parseFile(filePath: string): Promise<SessionDataImpl> {
    // Pass 1: Read and collect all entries
    await this.collectEntries(filePath);
    
    // Pass 2: Build relationships
    this.buildRelationships();
    
    // Pass 3: Calculate statistics
    this.calculateStatistics();
    
    return this.sessionData;
  }

  /**
   * Parse JSONL content from string
   */
  parseContent(content: string): SessionDataImpl {
    const lines = content.split('\n').filter(line => line.trim());
    
    // Pass 1: Collect entries
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as JsonlEntry;
        this.entries.push(entry);
      } catch (error) {
        console.error('Failed to parse line:', line, error);
      }
    }
    
    // Pass 2: Build relationships
    this.buildRelationships();
    
    // Pass 3: Calculate statistics
    this.calculateStatistics();
    
    return this.sessionData;
  }

  /**
   * Pass 1: Collect all entries from file
   */
  private async collectEntries(filePath: string): Promise<void> {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (line.trim()) {
        try {
          const entry = JSON.parse(line) as JsonlEntry;
          this.entries.push(entry);
        } catch (error) {
          console.error('Failed to parse line:', line, error);
        }
      }
    }
  }

  /**
   * Pass 2: Build relationships between entries
   */
  private buildRelationships(): void {
    // Process all entries
    for (const entry of this.entries) {
      // Skip file-history-snapshot and progress entries
      if (entry.type === 'file-history-snapshot' || entry.type === 'progress') {
        continue;
      }

      // Process user and assistant messages
      if (entry.type === 'user') {
        this.parseUserMessage(entry);
      } else if (entry.type === 'assistant') {
        this.parseAssistantMessage(entry);
      } else if (entry.type === 'system') {
        this.parseSystemMessage(entry);
      } else if (entry.type === 'message') {
        // Legacy format support
        this.processMessageEntry(entry);
      } else if (entry.type === 'metadata') {
        this.processMetadataEntry(entry);
      } else if (entry.type === 'tool-use') {
        this.processToolUseEntry(entry);
      } else if (entry.type === 'tool-result') {
        this.processToolResultEntry(entry);
      } else if (entry.type === 'content-replacement') {
        this.processReplacementEntry(entry);
      }
    }

    // Build parent-child relationships
    this.sessionData.buildMessageRelationships();
    
    // Build branch tree
    this.sessionData.buildBranchTree();
  }

  /**
   * Parse user message (real JSONL format)
   */
  private parseUserMessage(entry: any): void {
    const message = entry.message;
    
    // Safety check: ensure message exists
    if (!message) {
      console.warn('User entry missing message field:', entry.uuid);
      return;
    }
    
    // Extract content - can be string or array
    let contentText = '';
    const toolResults: ToolResultInfo[] = [];
    
    if (typeof message.content === 'string') {
      contentText = message.content;
    } else if (Array.isArray(message.content)) {
      // Process content array
      for (const block of message.content) {
        if (block.type === 'text') {
          contentText += block.text || '';
        } else if (block.type === 'tool_result') {
          // Extract tool result
          const toolResult: ToolResultInfo = {
            tool_use_id: block.tool_use_id,
            content: block.content || '',
            is_error: block.is_error || false,
            timestamp: entry.timestamp,
            messageId: message.id || entry.uuid,
            messageUuid: entry.uuid,
          };
          toolResults.push(toolResult);
          this.sessionData.addToolResult(toolResult);
        }
      }
    }

    const messageNode: MessageNode = {
      uuid: entry.uuid,
      messageId: message.id || entry.uuid,
      type: 'user' as MessageType,
      timestamp: entry.timestamp,
      content: contentText,
      parentUuid: entry.parentUuid || null,
      agentId: entry.agentId,
      isSidechain: entry.isSidechain,
      children: [],
      toolUses: [],
      toolResults: toolResults,
      replacements: [],
    };

    this.sessionData.addMessage(messageNode);

    // Ensure agent exists if this is a sidechain message
    if (entry.agentId) {
      this.ensureAgent(entry.agentId);
    }
  }

  /**
   * Parse assistant message (real JSONL format)
   */
  private parseAssistantMessage(entry: any): void {
    const message = entry.message;
    
    // Safety check: ensure message exists
    if (!message) {
      console.warn('Assistant entry missing message field:', entry.uuid);
      return;
    }
    
    // Extract content - can be string or array
    let contentText = '';
    const toolUses: ToolUseInfo[] = [];
    
    if (typeof message.content === 'string') {
      contentText = message.content;
    } else if (Array.isArray(message.content)) {
      // Process content array
      for (const block of message.content) {
        if (block.type === 'text') {
          contentText += block.text || '';
        } else if (block.type === 'thinking') {
          // Include thinking in content
          contentText += `[Thinking: ${block.thinking}]\n`;
        } else if (block.type === 'tool_use') {
          // Extract tool use
          const toolUse: ToolUseInfo = {
            id: block.id,
            name: block.name,
            input: block.input,
            timestamp: entry.timestamp,
            messageId: message.id,
            messageUuid: entry.uuid,
            agentId: entry.agentId,
            hasResult: false,
          };
          toolUses.push(toolUse);
          this.sessionData.addToolUse(toolUse);
        }
      }
    }

    const messageNode: MessageNode = {
      uuid: entry.uuid,
      messageId: message.id,
      type: 'assistant' as MessageType,
      timestamp: entry.timestamp,
      content: contentText,
      parentUuid: entry.parentUuid || null,
      agentId: entry.agentId,
      isSidechain: entry.isSidechain,
      model: message.model,
      stop_reason: message.stop_reason,
      usage: message.usage,
      children: [],
      toolUses: toolUses,
      toolResults: [],
      replacements: [],
    };

    this.sessionData.addMessage(messageNode);

    // Ensure agent exists if this is a sidechain message
    if (entry.agentId) {
      this.ensureAgent(entry.agentId);
    }
  }

  /**
   * Parse system message
   */
  private parseSystemMessage(entry: any): void {
    const message = entry.message;
    
    // Safety check: ensure message exists
    if (!message) {
      console.warn('System entry missing message field:', entry.uuid);
      return;
    }
    
    let contentText = '';
    if (typeof message.content === 'string') {
      contentText = message.content;
    } else if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === 'text') {
          contentText += block.text || '';
        }
      }
    }

    const messageNode: MessageNode = {
      uuid: entry.uuid,
      messageId: message.id || entry.uuid,
      type: 'system' as MessageType,
      timestamp: entry.timestamp,
      content: contentText,
      parentUuid: entry.parentUuid || null,
      children: [],
      toolUses: [],
      toolResults: [],
      replacements: [],
    };

    this.sessionData.addMessage(messageNode);
  }

  /**
   * Pass 3: Calculate statistics and build indexes
   */
  private calculateStatistics(): void {
    // Apply compression operations before calculating statistics
    this.applyCompressionOperations();
    
    // Sort timeline
    this.sessionData.sortTimeline();
    
    // Statistics are already calculated incrementally during parsing
    // This pass is for any final calculations or validations
  }

  /**
   * Apply compression operations to the messages Map.
   * This includes:
   * 1. Preserved segment relinks (compact_boundary with preservedSegment)
   * 2. Snip removals (compact_boundary with snipMetadata.removedUuids)
   */
  private applyCompressionOperations(): void {
    this.applyPreservedSegmentRelinks();
    this.applySnipRemovals();
  }

  /**
   * Splice the preserved segment back into the chain after compaction.
   * 
   * Preserved messages exist in the JSONL with their ORIGINAL pre-compact
   * parentUuids. The internal chain (keep[i+1]→keep[i]) is intact; only 
   * endpoints need patching: head→anchor, and anchor's other children→tail.
   * 
   * Only the LAST seg-boundary is relinked — earlier segs were summarized
   * into it. Everything physically before the absolute-last boundary (except
   * preservedUuids) is deleted.
   */
  private applyPreservedSegmentRelinks(): void {
    type Seg = {
      headUuid: string;
      tailUuid: string;
      anchorUuid: string;
    };

    const messages = this.sessionData.messages;
    
    // Find the absolute-last boundary and the last seg-boundary
    let lastSeg: Seg | undefined;
    let lastSegBoundaryIdx = -1;
    let absoluteLastBoundaryIdx = -1;
    const entryIndex = new Map<string, number>();
    
    let i = 0;
    for (const [uuid, entry] of messages.entries()) {
      entryIndex.set(uuid, i);
      
      // Check if this is a compact_boundary system message
      if (entry.type === 'system' && 
          (entry as any).subtype === 'compact_boundary') {
        absoluteLastBoundaryIdx = i;
        
        const compactMetadata = (entry as any).compactMetadata;
        const seg = compactMetadata?.preservedSegment;
        if (seg && seg.headUuid && seg.tailUuid && seg.anchorUuid) {
          lastSeg = seg;
          lastSegBoundaryIdx = i;
        }
      }
      i++;
    }

    // No seg anywhere → no-op
    if (!lastSeg) return;

    // Seg stale (no-seg boundary came after): skip relink, still prune at absolute
    const segIsLive = lastSegBoundaryIdx === absoluteLastBoundaryIdx;

    // Validate tail→head BEFORE mutating
    const preservedUuids = new Set<string>();
    if (segIsLive) {
      const walkSeen = new Set<string>();
      let cur = messages.get(lastSeg.tailUuid);
      let reachedHead = false;
      
      while (cur && !walkSeen.has(cur.uuid)) {
        walkSeen.add(cur.uuid);
        preservedUuids.add(cur.uuid);
        
        if (cur.uuid === lastSeg.headUuid) {
          reachedHead = true;
          break;
        }
        
        cur = cur.parentUuid ? messages.get(cur.parentUuid) : undefined;
      }
      
      if (!reachedHead) {
        // tail→head walk broke — skip relink and prune
        console.warn('Preserved segment walk broken - skipping relink');
        return;
      }
    }

    if (segIsLive) {
      // Relink head → anchor
      const head = messages.get(lastSeg.headUuid);
      if (head) {
        messages.set(lastSeg.headUuid, {
          ...head,
          parentUuid: lastSeg.anchorUuid,
        });
      }
      
      // Tail-splice: anchor's other children → tail
      for (const [uuid, msg] of messages) {
        if (msg.parentUuid === lastSeg.anchorUuid && uuid !== lastSeg.headUuid) {
          messages.set(uuid, { ...msg, parentUuid: lastSeg.tailUuid });
        }
      }
      
      // Zero stale usage for preserved messages
      for (const uuid of preservedUuids) {
        const msg = messages.get(uuid);
        if (msg?.type !== 'assistant') continue;
        
        if (msg.usage) {
          messages.set(uuid, {
            ...msg,
            usage: {
              input_tokens: 0,
              output_tokens: 0,
            },
          });
        }
      }
    }

    // Prune everything physically before the absolute-last boundary that isn't preserved
    const toDelete: string[] = [];
    for (const [uuid] of messages) {
      const idx = entryIndex.get(uuid);
      if (idx !== undefined && 
          idx < absoluteLastBoundaryIdx && 
          !preservedUuids.has(uuid)) {
        toDelete.push(uuid);
      }
    }
    
    for (const uuid of toDelete) {
      messages.delete(uuid);
    }
  }

  /**
   * Delete messages that Snip executions removed from the in-memory array,
   * and relink parentUuid across the gaps.
   * 
   * Unlike compact_boundary which truncates a prefix, snip removes middle ranges.
   * The JSONL is append-only, so removed messages stay on disk and the surviving
   * messages' parentUuid chains walk through them.
   */
  private applySnipRemovals(): void {
    type WithSnipMeta = { snipMetadata?: { removedUuids?: string[] } };
    
    const messages = this.sessionData.messages;
    const toDelete = new Set<string>();
    
    // Collect all removed UUIDs from snip boundaries
    for (const entry of messages.values()) {
      const removedUuids = (entry as WithSnipMeta).snipMetadata?.removedUuids;
      if (!removedUuids) continue;
      
      for (const uuid of removedUuids) {
        toDelete.add(uuid);
      }
    }
    
    if (toDelete.size === 0) return;

    // Capture each to-delete entry's parentUuid before deleting
    const deletedParent = new Map<string, string | null>();
    let removedCount = 0;
    
    for (const uuid of toDelete) {
      const entry = messages.get(uuid);
      if (!entry) continue;
      
      deletedParent.set(uuid, entry.parentUuid ?? null);
      messages.delete(uuid);
      removedCount++;
    }

    // Relink survivors with dangling parentUuid
    const resolve = (start: string): string | null => {
      const path: string[] = [];
      let cur: string | null = start;
      
      while (cur && toDelete.has(cur)) {
        path.push(cur);
        const next = deletedParent.get(cur);
        if (next === undefined) {
          cur = null;
          break;
        }
        cur = next;
      }
      
      // Path compression
      for (const p of path) {
        deletedParent.set(p, cur);
      }
      
      return cur;
    };
    
    let relinkedCount = 0;
    for (const [uuid, msg] of messages) {
      if (!msg.parentUuid || !toDelete.has(msg.parentUuid)) continue;
      
      const resolvedParent = resolve(msg.parentUuid);
      messages.set(uuid, { ...msg, parentUuid: resolvedParent });
      relinkedCount++;
    }

    console.log(`Snip compression applied: removed ${removedCount} messages, relinked ${relinkedCount} messages`);
  }

  /**
   * Process a message entry (legacy format)
   */
  private processMessageEntry(entry: JsonlEntry): void {
    if (entry.type !== 'message') return;

    const message = entry.message;
    const messageNode: MessageNode = {
      uuid: entry.uuid,
      messageId: message.id,
      type: message.type as MessageType,
      timestamp: entry.timestamp,
      content: message.content,
      parentUuid: message.parentUuid,
      agentId: 'agentId' in message ? message.agentId : undefined,
      isSidechain: 'isSidechain' in message ? message.isSidechain : undefined,
      model: 'model' in message ? message.model : undefined,
      stop_reason: 'stop_reason' in message ? message.stop_reason : undefined,
      usage: 'usage' in message ? message.usage : undefined,
      children: [],
      toolUses: [],
      toolResults: [],
      replacements: [],
    };

    this.sessionData.addMessage(messageNode);

    // Ensure agent exists if this is a sidechain message
    if ('agentId' in message && message.agentId) {
      this.ensureAgent(message.agentId);
    }
  }

  /**
   * Process a metadata entry
   */
  private processMetadataEntry(entry: JsonlEntry): void {
    if (entry.type !== 'metadata') return;

    const metadata = entry.metadata;
    
    // Safety check: ensure metadata exists
    if (!metadata) {
      console.warn('Metadata entry missing metadata field:', entry);
      return;
    }

    switch (metadata.type) {
      case 'custom-title':
        this.sessionData.title = metadata.title;
        break;
      case 'ai-title':
        // AI title can override custom title if no custom title exists
        if (!this.sessionData.title) {
          this.sessionData.title = metadata.title;
        }
        break;
      case 'tag':
        // Tags is an array in metadata
        if (metadata.tags) {
          this.sessionData.tags.push(...metadata.tags);
        }
        break;
      case 'agent-name':
        if (metadata.agentId) {
          const agent = this.sessionData.agents.get(metadata.agentId);
          if (agent) {
            agent.name = metadata.name;
          } else {
            this.sessionData.addAgent({
              agentId: metadata.agentId,
              name: metadata.name,
              messageUuids: [],
              toolUseCount: 0,
              createdAt: entry.timestamp,
            });
          }
        }
        break;
      case 'mode':
        this.sessionData.mode = metadata.mode;
        break;
      case 'worktree-state':
        // Store worktree state in a custom way if needed
        // For now, we'll skip it as SessionDataImpl doesn't have this field
        break;
      case 'pr-link':
        this.sessionData.prLinks.push({
          url: metadata.url,
          number: metadata.number,
          timestamp: entry.timestamp,
        });
        break;
    }
  }

  /**
   * Process a tool-use entry
   */
  private processToolUseEntry(entry: JsonlEntry): void {
    if (entry.type !== 'tool-use') return;

    const toolUse = entry.toolUse;
    const toolUseInfo: ToolUseInfo = {
      id: toolUse.id,
      name: toolUse.name,
      input: toolUse.input,
      timestamp: entry.timestamp,
      messageId: toolUse.messageId,
      messageUuid: entry.uuid,
      agentId: toolUse.agentId,
      hasResult: false,
    };

    this.sessionData.addToolUse(toolUseInfo);

    // Ensure agent exists if this is a sidechain tool use
    if (toolUse.agentId) {
      this.ensureAgent(toolUse.agentId);
    }
  }

  /**
   * Process a tool-result entry
   */
  private processToolResultEntry(entry: JsonlEntry): void {
    if (entry.type !== 'tool-result') return;

    const toolResult = entry.toolResult;
    const toolResultInfo: ToolResultInfo = {
      tool_use_id: toolResult.tool_use_id,
      content: toolResult.content,
      is_error: toolResult.is_error || false,
      timestamp: entry.timestamp,
      messageId: toolResult.messageId,
      messageUuid: entry.uuid,
    };

    this.sessionData.addToolResult(toolResultInfo);
  }

  /**
   * Process a content-replacement entry
   */
  private processReplacementEntry(entry: JsonlEntry): void {
    if (entry.type !== 'content-replacement') return;

    const replacement = entry.replacement;
    const replacementRecord: ContentReplacementRecord = {
      uuid: entry.uuid,
      timestamp: entry.timestamp,
      messageId: replacement.messageId,
      toolUseId: replacement.toolUseId,
      originalContent: replacement.originalContent,
      replacementContent: replacement.replacementContent,
      reason: replacement.reason,
    };

    this.sessionData.addReplacement(replacementRecord);
  }

  /**
   * Ensure an agent exists in the session data
   */
  private ensureAgent(agentId: string): void {
    if (!this.sessionData.agents.has(agentId)) {
      this.sessionData.addAgent({
        agentId,
        name: `Agent ${agentId.substring(0, 8)}`,
        messageUuids: [],
        toolUseCount: 0,
        createdAt: Date.now(),
      });
    }
  }
}