import { SessionData, MessageNode, ToolUseInfo, ContentBlock } from '../../ClaudeCodeStructure/src/types';
import { EvaluationEvent, EventStreamAnalysisSummary } from '../types/evaluation.types';
import { ContextChainAnalyzer } from './ContextChainAnalyzer';

/**
 * 事件流转换器
 * 将SessionData转换为标准化的评估事件流
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
   * 转换SessionData为事件流
   */
  convert(): EvaluationEvent[] {
    this.events = [];
    this.stepCounter = 0;

    // 获取所有消息,按时间排序
    const messages = Array.from(this.sessionData.messages.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    // 转换每个消息为事件
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
   * 转换单个消息为事件
   */
  private convertMessage(message: MessageNode): void {
    const runId = this.extractRunId();

    // 确定actor
    const actor = this.determineActor(message);
    const actorName = message.agentId || message.type;

    // 提取文件操作
    const { filesRead, filesWritten } = this.extractFileOperations(message);

    // 计算上下文tokens
    const { tokensBefore, tokensAfter } = this.calculateContextTokens(message);

    // 如果是assistant消息,可能包含工具调用
    if (message.type === 'assistant' && message.toolUses.length > 0) {
      // 为每个工具调用创建事件
      for (const toolUse of message.toolUses) {
        this.convertToolUse(toolUse, message, runId, actor, actorName, tokensBefore, tokensAfter);
      }
    } else {
      // 普通消息事件
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
   * 转换工具调用为事件
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

    // 提取文件操作
    const { filesRead, filesWritten } = this.extractFileOperationsFromTool(toolUse, toolResult);

    // 工具调用事件
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

    // 如果有工具结果,创建工具结果事件
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
   * 确定actor类型
   */
  private determineActor(message: MessageNode): EvaluationEvent['actor'] {
    if (message.type === 'user') return 'user';
    if (message.type === 'assistant') return message.agentId ? 'agent' : 'assistant';
    if (message.type === 'system') return 'system';
    return 'assistant';
  }

  /**
   * 提取文本内容
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
   * 从消息中提取文件操作
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
   * 从工具调用中提取文件操作
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

    // 根据工具类型提取文件路径
    const toolName = toolUse.name;
    const input = toolUse.input;

    if (toolName === 'Read' && input.file_path) {
      filesRead.push(input.file_path);
    } else if ((toolName === 'Write' || toolName === 'Edit') && input.file_path) {
      filesWritten.push(input.file_path);
    } else if (toolName === 'Glob' && toolResult && !toolResult.is_error) {
      // Glob的结果包含文件列表,暂不提取
    } else if (toolName === 'Bash') {
      // Bash命令可能涉及文件操作,但难以准确提取
    }

    return { filesRead, filesWritten };
  }

  /**
   * 计算消息前后的上下文tokens
   */
  private calculateContextTokens(message: MessageNode): {
    tokensBefore: number;
    tokensAfter: number;
  } {
    return this.contextChains.getContextTokenStats(message.uuid);
  }

  /**
   * 计算工具结果后的tokens
   */
  private calculateTokensAfterResult(toolResult: any): number {
    // 简化处理:估算工具结果的token数
    if (typeof toolResult.content === 'string') {
      return Math.ceil(toolResult.content.length / 4); // 粗略估算
    }
    return 0;
  }

  /**
   * 检查消息是否被压缩
   */
  private isCompressed(message: MessageNode): boolean {
    // 通过替换记录检测压缩
    for (const replacement of this.sessionData.replacements.values()) {
      if (replacement.messageId === message.messageId) {
        return true;
      }
    }
    return false;
  }

  /**
   * 查找父步骤ID
   */
  private findParentStepId(message: MessageNode): number | undefined {
    if (!message.parentUuid) return undefined;

    const parentEvent = this.events.find(e => e.messageUuid === message.parentUuid);
    return parentEvent?.step_id;
  }

  /**
   * 提取runId
   */
  private extractRunId(): string {
    // 从第一条消息的UUID中提取run ID
    // 实际实现中可能需要从文件名或其他地方获取
    const firstMessage = Array.from(this.sessionData.messages.values())[0];
    return firstMessage ? firstMessage.uuid.substring(0, 8) : 'unknown';
  }
}
