import * as fs from 'fs';
import { SessionDataImpl } from '../../ClaudeCodeStructure/src/SessionData';
import {
  MessageNode,
  MessageType,
  SessionData,
  ToolResultInfo,
  ToolUseInfo,
} from '../../ClaudeCodeStructure/src/types';

type RolloutEntry = {
  timestamp?: string;
  type?: string;
  payload?: Record<string, any>;
};

type PendingStructuredResult = {
  timestamp: number;
  content: string;
  isError: boolean;
};

class RolloutSessionBuilder {
  private session = new SessionDataImpl();
  private messageCounter = 0;
  private toolCounter = 0;
  private lastMessageUuid: string | null = null;

  addMessage(params: {
    type: MessageType;
    content: string;
    timestamp: number;
    usage?: { input_tokens: number; output_tokens: number };
    model?: string;
    stop_reason?: string;
  }): MessageNode {
    const uuid = `codex-msg-${++this.messageCounter}`;
    const message: MessageNode = {
      uuid,
      messageId: uuid,
      type: params.type,
      timestamp: params.timestamp,
      content: params.content,
      parentUuid: this.lastMessageUuid,
      model: params.model,
      stop_reason: params.stop_reason,
      usage: params.usage,
      children: [],
      toolUses: [],
      toolResults: [],
      replacements: [],
    };
    this.session.addMessage(message);
    this.lastMessageUuid = uuid;
    return message;
  }

  addToolUse(
    message: MessageNode,
    timestamp: number,
    name: string,
    input: Record<string, any>
  ): ToolUseInfo {
    const id = `codex-tool-${++this.toolCounter}`;
    const toolUse: ToolUseInfo = {
      id,
      name,
      input,
      timestamp,
      messageId: message.messageId,
      messageUuid: message.uuid,
      hasResult: false,
    };
    message.toolUses.push(toolUse);
    this.session.addToolUse(toolUse);
    return toolUse;
  }

  addToolResult(
    message: MessageNode,
    timestamp: number,
    content: string,
    is_error: boolean,
    toolUseId: string
  ): ToolResultInfo {
    const toolResult: ToolResultInfo = {
      tool_use_id: toolUseId,
      content,
      is_error,
      timestamp,
      messageId: message.messageId,
      messageUuid: message.uuid,
    };
    message.toolResults.push(toolResult);
    this.session.addToolResult(toolResult);
    return toolResult;
  }

  finalize(): SessionData {
    this.session.buildMessageRelationships();
    this.session.buildBranchTree();
    this.session.sortTimeline();
    return this.session;
  }
}

export function loadCodexRolloutSession(filePath: string): SessionData {
  const rawEntries = fs
    .readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RolloutEntry);

  const builder = new RolloutSessionBuilder();
  const toolUseByCallId = new Map<string, string>();
  const structuredResults = new Map<string, PendingStructuredResult>();

  rawEntries.forEach((entry, index) => {
    const timestamp = safeTimestamp(entry.timestamp, index);
    const payload = entry.payload || {};

    if (entry.type === 'event_msg') {
      handleEventMessage(builder, payload, timestamp, structuredResults);
      return;
    }

    if (entry.type !== 'response_item') {
      return;
    }

    const payloadType = String(payload.type || '');
    if (payloadType === 'message') {
      const role = normalizeRole(String(payload.role || 'assistant'));
      const content = flattenRolloutContent(payload.content);
      if (content) {
        builder.addMessage({
          type: role,
          content,
          timestamp,
          usage: normalizeUsage(payload.usage),
        });
      }
      return;
    }

    if (payloadType === 'reasoning') {
      const summary = flattenReasoningSummary(payload.summary);
      if (summary) {
        builder.addMessage({
          type: 'assistant',
          content: `[reasoning] ${summary}`,
          timestamp,
        });
      }
      return;
    }

    if (payloadType === 'function_call' || payloadType === 'custom_tool_call') {
      const mappedTool = normalizeToolCall(payload);
      const assistant = builder.addMessage({
        type: 'assistant',
        content: `Invoking ${mappedTool.name}`,
        timestamp,
      });
      const toolUse = builder.addToolUse(
        assistant,
        timestamp,
        mappedTool.name,
        mappedTool.input
      );
      if (payload.call_id) {
        toolUseByCallId.set(String(payload.call_id), toolUse.id);
      }
      return;
    }

    if (
      payloadType === 'function_call_output' ||
      payloadType === 'custom_tool_call_output'
    ) {
      const callId = String(payload.call_id || '');
      const toolUseId = toolUseByCallId.get(callId);
      if (!toolUseId) {
        return;
      }

      const structured = structuredResults.get(callId);
      const content = structured
        ? structured.content
        : stringifyValue(payload.output || payload);
      const isError = structured
        ? structured.isError
        : detectToolErrorFromText(content);
      const user = builder.addMessage({
        type: 'user',
        content,
        timestamp: structured ? structured.timestamp : timestamp,
      });
      builder.addToolResult(
        user,
        structured ? structured.timestamp : timestamp,
        content,
        isError,
        toolUseId
      );
      structuredResults.delete(callId);
    }
  });

  for (const [callId, pending] of structuredResults.entries()) {
    const toolUseId = toolUseByCallId.get(callId);
    if (!toolUseId) {
      continue;
    }
    const user = builder.addMessage({
      type: 'user',
      content: pending.content,
      timestamp: pending.timestamp,
    });
    builder.addToolResult(
      user,
      pending.timestamp,
      pending.content,
      pending.isError,
      toolUseId
    );
  }

  return builder.finalize();
}

function handleEventMessage(
  builder: RolloutSessionBuilder,
  payload: Record<string, any>,
  timestamp: number,
  structuredResults: Map<string, PendingStructuredResult>
) {
  const payloadType = String(payload.type || '');
  if (payloadType === 'user_message') {
    const message = String(payload.message || '');
    if (message) {
      builder.addMessage({
        type: 'user',
        content: message,
        timestamp,
      });
    }
    return;
  }

  if (payloadType === 'agent_message') {
    const message = String(payload.message || '');
    if (message) {
      builder.addMessage({
        type: 'assistant',
        content: message,
        timestamp,
      });
    }
    return;
  }

  if (payloadType === 'exec_command_end') {
    const callId = String(payload.call_id || '');
    if (callId) {
      structuredResults.set(callId, {
        timestamp,
        content: extractExecOutput(payload),
        isError:
          typeof payload.exit_code === 'number'
            ? payload.exit_code !== 0
            : String(payload.status || '').toLowerCase() === 'failed',
      });
    }
    return;
  }

  if (payloadType === 'patch_apply_end') {
    const callId = String(payload.call_id || '');
    if (callId) {
      structuredResults.set(callId, {
        timestamp,
        content: extractPatchApplyOutput(payload),
        isError: String(payload.status || '').toLowerCase() !== 'success',
      });
    }
    return;
  }

  if (payloadType === 'error') {
    const message = stringifyValue(payload);
    builder.addMessage({
      type: 'system',
      content: message,
      timestamp,
    });
  }
}

function safeTimestamp(value: string | undefined, fallbackIndex: number): number {
  if (!value) {
    return fallbackIndex;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallbackIndex;
}

function normalizeRole(role: string): MessageType {
  if (role === 'user') {
    return 'user';
  }
  if (role === 'assistant') {
    return 'assistant';
  }
  if (role === 'developer' || role === 'system') {
    return 'system';
  }
  return 'assistant';
}

function normalizeUsage(usage: Record<string, any> | undefined) {
  if (!usage) {
    return undefined;
  }
  const inputTokens = Number(usage.input_tokens || 0);
  const outputTokens = Number(usage.output_tokens || 0);
  if (!Number.isFinite(inputTokens) && !Number.isFinite(outputTokens)) {
    return undefined;
  }
  return {
    input_tokens: Number.isFinite(inputTokens) ? inputTokens : 0,
    output_tokens: Number.isFinite(outputTokens) ? outputTokens : 0,
  };
}

function flattenRolloutContent(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (!Array.isArray(value)) {
    return '';
  }

  return value
    .map((block) => {
      if (typeof block === 'string') {
        return block;
      }
      if (!block || typeof block !== 'object') {
        return '';
      }
      if (typeof block.text === 'string') {
        return block.text;
      }
      if (typeof block.content === 'string') {
        return block.content;
      }
      if (Array.isArray(block.content)) {
        return flattenRolloutContent(block.content);
      }
      return '';
    })
    .filter(Boolean)
    .join('');
}

function flattenReasoningSummary(summary: unknown): string {
  if (typeof summary === 'string') {
    return summary;
  }
  if (!Array.isArray(summary)) {
    return '';
  }
  return summary
    .map((item) => {
      if (typeof item === 'string') {
        return item;
      }
      if (item && typeof item === 'object' && typeof item.text === 'string') {
        return item.text;
      }
      return '';
    })
    .filter(Boolean)
    .join(' ');
}

function normalizeToolCall(payload: Record<string, any>): {
  name: string;
  input: Record<string, any>;
} {
  const rawName = String(payload.name || 'tool');
  const parsedArguments = parseArguments(payload.arguments);

  if (rawName === 'exec_command') {
    return {
      name: 'Bash',
      input: {
        command: String(parsedArguments.cmd || ''),
        workdir: parsedArguments.workdir,
      },
    };
  }

  if (rawName === 'write_stdin') {
    return {
      name: 'Bash',
      input: {
        command: parsedArguments.chars
          ? `[stdin session=${parsedArguments.session_id}] ${parsedArguments.chars}`
          : `[poll session=${parsedArguments.session_id}]`,
        session_id: parsedArguments.session_id,
        chars: parsedArguments.chars || '',
      },
    };
  }

  if (rawName === 'apply_patch') {
    return {
      name: 'apply_patch',
      input:
        typeof parsedArguments === 'string'
          ? { patch: parsedArguments }
          : parsedArguments,
    };
  }

  return {
    name: rawName,
    input:
      typeof parsedArguments === 'string'
        ? { raw: parsedArguments }
        : parsedArguments,
  };
}

function parseArguments(value: unknown): any {
  if (typeof value !== 'string') {
    return value && typeof value === 'object' ? value : {};
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function extractExecOutput(payload: Record<string, any>): string {
  const chunks = [
    stringifyValue(payload.aggregated_output),
    stringifyValue(payload.formatted_output),
    stringifyValue(payload.stdout),
    stringifyValue(payload.stderr),
  ]
    .filter(Boolean)
    .join('\n');

  return chunks || stringifyValue(payload);
}

function extractPatchApplyOutput(payload: Record<string, any>): string {
  const chunks = [
    stringifyValue(payload.stdout),
    stringifyValue(payload.stderr),
    stringifyValue(payload.result),
  ]
    .filter(Boolean)
    .join('\n');
  return chunks || stringifyValue(payload);
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || typeof value === 'undefined') {
    return '';
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function detectToolErrorFromText(content: string): boolean {
  return (
    /\bProcess exited with code [1-9]/.test(content) ||
    /\bstatus["']?\s*:\s*["']failed["']/.test(content) ||
    /\bTraceback\b/.test(content) ||
    /\bError:/.test(content)
  );
}
