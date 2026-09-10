import { SessionData, MessageNode, ToolUseInfo, ContentBlock } from '../../ClaudeCodeStructure/src/types';
import { EvaluationEvent, EventStreamAnalysisSummary } from '../types/evaluation.types';
import { ContextChainAnalyzer } from './ContextChainAnalyzer';

/**
 * Event stream converter
 * Converts SessionData into a normalized evaluation event stream
 */
export class EventStreamConverter {
  private sessionData: SessionData;
  private events: EvaluationEvent[] = [];
  private stepCounter = 0;
  private contextChains: ContextChainAnalyzer;

  constructor(sessionData: SessionData) {
    this.sessionData = sessionData;
    this.contextChains = new ContextChainAnalyzer(sessionData);
  }

  /**
   * Converts SessionData into an event stream
   */
  convert(): EvaluationEvent[] {
    this.events = [];
    this.stepCounter = 0;

    // Collect all messages, sorted by time
    const messages = Array.from(this.sessionData.messages.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    // Convert each message into events
    for (const message of messages) {
      this.convertMessage(message);
    }

    return this.events;
  }

  buildSummary(): EventStreamAnalysisSummary {
    const events = this.convert();
    const actorCounts: Record<string, number> = {};
    const eventTypeCounts: Record<string, number> = {};

    for (const event of events) {
      actorCounts[event.actor] = (actorCounts[event.actor] || 0) + 1;
      eventTypeCounts[event.event_type] = (eventTypeCounts[event.event_type] || 0) + 1;
    }

    return {
      enabled: true,
      totalEvents: events.length,
      messageEvents: eventTypeCounts.message || 0,
      toolCallEvents: eventTypeCounts.tool_call || 0,
      toolResultEvents: eventTypeCounts.tool_result || 0,
      compressedEvents: events.filter((event) => event.compressed).length,
      actorCounts,
      eventTypeCounts,
    };
  }

  /**
   * Converts a single message into events
   */
  private convertMessage(message: MessageNode): void {
    const runId = this.extractRunId();

    // Determine the actor
    const actor = this.determineActor(message);
    const actorName = message.agentId || message.type;

    // Extract file operations
    const { filesRead, filesWritten } = this.extractFileOperations(message);

    // Compute context tokens
    const { tokensBefore, tokensAfter } = this.calculateContextTokens(message);

    // An assistant message may contain tool calls
    if (message.type === 'assistant' && message.toolUses.length > 0) {
      // Create an event for each tool call
      for (const toolUse of message.toolUses) {
        this.convertToolUse(toolUse, message, runId, actor, actorName, tokensBefore, tokensAfter);
      }
    } else {
      // Plain message event
      const event: EvaluationEvent = {
        run_id: runId,
        step_id: this.stepCounter++,
        timestamp: message.timestamp,
        actor,
        actor_name: actorName,
        event_type: 'message',
        input_text: this.extractTextContent(message.content),
        output_text: this.extractTextContent(message.content),
        files_read: filesRead,
        files_written: filesWritten,
        context_tokens_before: tokensBefore,
        context_tokens_after: tokensAfter,
        compressed: this.isCompressed(message),
        parent_step_id: this.findParentStepId(message),
        messageUuid: message.uuid,
        messageId: message.messageId,
        agentId: message.agentId,
      };

      this.events.push(event);
    }
  }

  /**
   * Converts a tool call into events
   */
  private convertToolUse(
    toolUse: ToolUseInfo,
    message: MessageNode,
    runId: string,
    actor: EvaluationEvent['actor'],
    actorName: string,
    tokensBefore: number,
    tokensAfter: number
  ): void {
    const toolResult = this.sessionData.toolResults.get(toolUse.id);

    // Extract file operations
    const { filesRead, filesWritten } = this.extractFileOperationsFromTool(toolUse, toolResult);

    // Tool call event
    const toolCallEvent: EvaluationEvent = {
      run_id: runId,
      step_id: this.stepCounter++,
      timestamp: toolUse.timestamp,
      actor,
      actor_name: actorName,
      event_type: 'tool_call',
      tool_name: toolUse.name,
      input_text: JSON.stringify(toolUse.input),
      output_text: undefined,
      files_read: filesRead,
      files_written: filesWritten,
      context_tokens_before: tokensBefore,
      context_tokens_after: tokensAfter,
      compressed: this.isCompressed(message),
      parent_step_id: this.findParentStepId(message),
      messageUuid: message.uuid,
      messageId: message.messageId,
      agentId: message.agentId,
    };

    this.events.push(toolCallEvent);

    // If a tool result exists, create a tool result event
    if (toolResult) {
      const resultEvent: EvaluationEvent = {
        run_id: runId,
        step_id: this.stepCounter++,
        timestamp: toolResult.timestamp,
        actor: 'tool',
        actor_name: toolUse.name,
        event_type: 'tool_result',
        tool_name: toolUse.name,
        input_text: undefined,
        output_text: this.extractTextContent(toolResult.content),
        files_read: [],
        files_written: [],
        context_tokens_before: tokensAfter,
        context_tokens_after: this.calculateTokensAfterResult(toolResult),
        compressed: false,
        parent_step_id: toolCallEvent.step_id,
        messageUuid: toolResult.messageUuid,
        messageId: toolResult.messageId,
        is_error: toolResult.is_error,
      };

      this.events.push(resultEvent);
    }
  }

  /**
   * Determines the actor type
   */
  private determineActor(message: MessageNode): EvaluationEvent['actor'] {
    if (message.type === 'user') return 'user';
    if (message.type === 'assistant') return message.agentId ? 'agent' : 'assistant';
    if (message.type === 'system') return 'system';
    return 'assistant';
  }

  /**
   * Extracts text content
   */
  private extractTextContent(content: string | ContentBlock[] | undefined): string | undefined {
    if (!content) return undefined;

    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .filter(block => block.type === 'text')
        .map((block: any) => block.text)
        .join('\n');
    }

    return undefined;
  }

  /**
   * Extracts file operations from a message
   */
  private extractFileOperations(message: MessageNode): {
    filesRead: string[];
    filesWritten: string[];
  } {
    const filesRead: string[] = [];
    const filesWritten: string[] = [];

    for (const toolUse of message.toolUses) {
      const { filesRead: read, filesWritten: written } =
        this.extractFileOperationsFromTool(toolUse, this.sessionData.toolResults.get(toolUse.id));

      filesRead.push(...read);
      filesWritten.push(...written);
    }

    return { filesRead, filesWritten };
  }

  /**
   * Extracts file operations from a tool call
   */
  private extractFileOperationsFromTool(
    toolUse: ToolUseInfo,
    toolResult?: any
  ): {
    filesRead: string[];
    filesWritten: string[];
  } {
    const filesRead: string[] = [];
    const filesWritten: string[] = [];

    // Extract file paths according to the tool type
    const toolName = toolUse.name;
    const input = toolUse.input;

    if (toolName === 'Read' && input.file_path) {
      filesRead.push(input.file_path);
    } else if ((toolName === 'Write' || toolName === 'Edit') && input.file_path) {
      filesWritten.push(input.file_path);
    } else if (toolName === 'Glob' && toolResult && !toolResult.is_error) {
      // Glob results contain a file list; not extracted for now
    } else if (toolName === 'Bash') {
      // Bash commands may involve file operations, but they are hard to extract accurately
    }

    return { filesRead, filesWritten };
  }

  /**
   * Computes the context tokens before and after a message
   */
  private calculateContextTokens(message: MessageNode): {
    tokensBefore: number;
    tokensAfter: number;
  } {
    return this.contextChains.getContextTokenStats(message.uuid);
  }

  /**
   * Computes the token count after a tool result
   */
  private calculateTokensAfterResult(toolResult: any): number {
    // Simplified handling: estimate the token count of the tool result
    if (typeof toolResult.content === 'string') {
      return Math.ceil(toolResult.content.length / 4); // Rough estimate
    }
    return 0;
  }

  /**
   * Checks whether a message was compressed
   */
  private isCompressed(message: MessageNode): boolean {
    // Detect compression through the replacement records
    for (const replacement of this.sessionData.replacements.values()) {
      if (replacement.messageId === message.messageId) {
        return true;
      }
    }
    return false;
  }

  /**
   * Finds the parent step ID
   */
  private findParentStepId(message: MessageNode): number | undefined {
    if (!message.parentUuid) return undefined;

    const parentEvent = this.events.find(e => e.messageUuid === message.parentUuid);
    return parentEvent?.step_id;
  }

  /**
   * Extracts the runId
   */
  private extractRunId(): string {
    // Extract the run ID from the UUID of the first message
    // A real implementation may need to obtain it from the file name or elsewhere
    const firstMessage = Array.from(this.sessionData.messages.values())[0];
    return firstMessage ? firstMessage.uuid.substring(0, 8) : 'unknown';
  }
}
