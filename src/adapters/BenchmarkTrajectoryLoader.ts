import * as fs from 'fs';
import * as path from 'path';
import { SessionDataImpl } from '../../ClaudeCodeStructure/src/SessionData';
import {
  MessageNode,
  MessageType,
  SessionData,
  ToolResultInfo,
  ToolUseInfo,
} from '../../ClaudeCodeStructure/src/types';

export type BenchmarkSource = 'android-bench' | 'terminal-bench' | 'swe-bench';

export interface BenchmarkTrajectoryMetadata {
  source: BenchmarkSource;
  benchmark: string;
  taskId: string;
  trialId?: string;
  runName?: string;
  success?: boolean;
  status?: string;
  reward?: number;
  tokens?: number;
  costUsd?: number;
  rawPath: string;
}

export interface LoadedBenchmarkTrajectory {
  sessionData: SessionData;
  metadata: BenchmarkTrajectoryMetadata;
}

const androidScoresCache = new Map<string, Record<string, any>>();
const sweResultsCache = new Map<string, Record<string, string[]>>();

type PendingToolResult = {
  toolUseId: string;
  messageUuid: string;
};

class SessionBuilder {
  private session = new SessionDataImpl();
  private messageCounter = 0;
  private toolCounter = 0;
  private lastMessageUuid: string | null = null;
  private pendingToolResult: PendingToolResult | null = null;

  addMessage(params: {
    type: MessageType;
    content: string;
    timestamp: number;
    usage?: { input_tokens: number; output_tokens: number };
    model?: string;
    stop_reason?: string;
  }): MessageNode {
    const uuid = `msg-${++this.messageCounter}`;
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
    const id = `tool-${++this.toolCounter}`;
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
    this.pendingToolResult = { toolUseId: id, messageUuid: message.uuid };
    return toolUse;
  }

  addToolResult(
    message: MessageNode,
    timestamp: number,
    content: string,
    is_error?: boolean,
    toolUseId?: string
  ): ToolResultInfo | null {
    const effectiveToolUseId = toolUseId || this.pendingToolResult?.toolUseId;
    if (!effectiveToolUseId) {
      return null;
    }

    const toolResult: ToolResultInfo = {
      tool_use_id: effectiveToolUseId,
      content,
      is_error,
      timestamp,
      messageId: message.messageId,
      messageUuid: message.uuid,
    };
    message.toolResults.push(toolResult);
    this.session.addToolResult(toolResult);

    if (this.pendingToolResult?.toolUseId === effectiveToolUseId) {
      this.pendingToolResult = null;
    }

    return toolResult;
  }

  finalize(): SessionData {
    this.session.buildMessageRelationships();
    this.session.buildBranchTree();
    this.session.sortTimeline();
    return this.session;
  }
}

export function loadBenchmarkTrajectory(
  filePath: string,
  source?: BenchmarkSource
): LoadedBenchmarkTrajectory {
  const resolved = path.resolve(filePath);
  const detectedSource = source || detectBenchmarkSource(resolved);
  const raw = JSON.parse(fs.readFileSync(resolved, 'utf-8'));

  switch (detectedSource) {
    case 'android-bench':
      return loadAndroidBenchTrajectory(resolved, raw);
    case 'terminal-bench':
      return loadTerminalBenchTrajectory(resolved, raw);
    case 'swe-bench':
      return loadSweBenchTrajectory(resolved, raw);
    default:
      throw new Error(`Unsupported benchmark source for ${resolved}`);
  }
}

export function detectBenchmarkSource(filePath: string): BenchmarkSource {
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.endsWith('.traj')) {
    return 'swe-bench';
  }
  if (normalized.includes('/terminal_bench/') || normalized.includes('/terminal-bench/')) {
    return 'terminal-bench';
  }
  if (normalized.includes('/android_bench/') || normalized.includes('/android-bench/')) {
    return 'android-bench';
  }

  throw new Error(`Unable to infer benchmark source from path: ${filePath}`);
}

function loadAndroidBenchTrajectory(filePath: string, raw: any): LoadedBenchmarkTrajectory {
  const builder = new SessionBuilder();
  const messages = Array.isArray(raw.messages) ? raw.messages : [];

  for (let index = 0; index < messages.length; index++) {
    const entry = messages[index];
    const timestamp = toEpochMs(index);
    const role = normalizeRole(entry.role);
    const content = flattenContent(entry.content);
    const usage = extractAndroidUsage(entry);

    const message = builder.addMessage({
      type: role,
      content,
      timestamp,
      usage,
      model: entry.extra?.response?.model,
      stop_reason: entry.extra?.response?.choices?.[0]?.finish_reason,
    });

    if (role === 'assistant') {
      const command = extractBashCommand(content);
      if (command) {
        builder.addToolUse(message, timestamp, 'Bash', { command });
      }
      continue;
    }

    if (role === 'user') {
      const observation = parseTaggedObservation(content);
      builder.addToolResult(
        message,
        timestamp,
        observation.output || observation.raw,
        observation.returnCode !== null ? observation.returnCode !== 0 : undefined
      );
    }
  }

  const info = raw.info || {};
  const taskId = basenameWithoutExt(filePath);
  const nativeScore = lookupAndroidBenchScore(filePath, taskId);
  const status = String(nativeScore?.status || info.exit_status || '');
  const nativeTokens = Number(nativeScore?.used_tokens?.total_tokens || 0);
  const nativeCost = parseCost(nativeScore?.cost);
  const metadata: BenchmarkTrajectoryMetadata = {
    source: 'android-bench',
    benchmark: 'android-bench',
    taskId,
    status,
    success: nativeScore
      ? Number(nativeScore.score || 0) > 0 || status.toUpperCase() === 'PASSED'
      : status.toLowerCase() === 'submitted' || status.toLowerCase() === 'passed',
    tokens: nativeTokens > 0 ? nativeTokens : sumAndroidTokens(messages),
    costUsd: nativeCost ?? info.model_stats?.instance_cost,
    rawPath: filePath,
  };

  return {
    sessionData: builder.finalize(),
    metadata,
  };
}

function loadTerminalBenchTrajectory(filePath: string, raw: any): LoadedBenchmarkTrajectory {
  const builder = new SessionBuilder();
  const trajectory = raw.trajectory || {};
  const steps = Array.isArray(trajectory.steps) ? trajectory.steps : [];

  for (const step of steps) {
    const timestamp = safeParseTimestamp(step.timestamp);
    const role = step.source === 'user' ? 'user' : 'assistant';
    const content = String(step.message || '');
    const usage = extractTerminalUsage(step.metrics);
    const message = builder.addMessage({
      type: role,
      content,
      timestamp,
      usage,
      model: step.model_name,
    });

    if (role !== 'assistant') {
      continue;
    }

    const toolCalls = Array.isArray(step.tool_calls) ? step.tool_calls : [];
    const observationResults = Array.isArray(step.observation?.results)
      ? step.observation.results
      : [];

    for (let i = 0; i < toolCalls.length; i++) {
      const toolCall = toolCalls[i];
      const mapped = mapTerminalTool(toolCall.function_name, toolCall.arguments || {});
      const toolUse = builder.addToolUse(message, timestamp, mapped.name, mapped.input);
      const result = observationResults[i];
      if (result) {
        builder.addToolResult(
          message,
          timestamp,
          extractTerminalObservation(result, step.extra),
          detectErrorFromTerminalResult(result),
          toolUse.id
        );
      }
    }
  }

  const metadata: BenchmarkTrajectoryMetadata = {
    source: 'terminal-bench',
    benchmark: 'terminal-bench',
    taskId: String(raw.task_name || basenameWithoutExt(filePath)),
    trialId: raw.trial_id,
    reward: typeof raw.reward === 'number' ? raw.reward : undefined,
    success: Number(raw.reward || 0) > 0,
    tokens: extractTerminalTotalTokens(steps),
    costUsd: raw.trajectory?.final_metrics?.total_cost_usd,
    rawPath: filePath,
  };

  return {
    sessionData: builder.finalize(),
    metadata,
  };
}

function loadSweBenchTrajectory(filePath: string, raw: any): LoadedBenchmarkTrajectory {
  const builder = new SessionBuilder();
  const steps = Array.isArray(raw.trajectory) ? raw.trajectory : [];

  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const timestamp = toEpochMs(index);
    const assistantText = String(step.response || step.thought || step.action || '');
    const assistant = builder.addMessage({
      type: 'assistant',
      content: assistantText,
      timestamp,
    });

    const state = parseJsonObject(step.state);
    const mapped = mapSweBenchAction(String(step.action || ''), state);
    const toolUse = builder.addToolUse(assistant, timestamp, mapped.name, mapped.input);

    const user = builder.addMessage({
      type: 'user',
      content: String(step.observation || ''),
      timestamp: timestamp + 1,
    });

    builder.addToolResult(
      user,
      timestamp + 1,
      String(step.observation || ''),
      detectErrorFromText(String(step.observation || '')),
      toolUse.id
    );
  }

  const nativeResult = lookupSweBenchOutcome(filePath, basenameWithoutExt(filePath));
  const metadata: BenchmarkTrajectoryMetadata = {
    source: 'swe-bench',
    benchmark: 'swe-bench-verified',
    taskId: basenameWithoutExt(filePath),
    success: nativeResult.success,
    status: nativeResult.status,
    rawPath: filePath,
  };

  return {
    sessionData: builder.finalize(),
    metadata,
  };
}

function normalizeRole(role: string): MessageType {
  if (role === 'assistant' || role === 'system' || role === 'attachment') {
    return role;
  }
  return 'user';
}

function flattenContent(content: any): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((item) => {
      if (typeof item === 'string') {
        return item;
      }
      if (item?.type === 'text') {
        return item.text || '';
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function extractBashCommand(content: string): string | null {
  const fenced = content.match(/```bash\s*([\s\S]*?)```/i);
  if (fenced) {
    return fenced[1].trim();
  }
  const commandTag = content.match(/<command>\s*([\s\S]*?)\s*<\/command>/i);
  if (commandTag) {
    return commandTag[1].trim();
  }
  return null;
}

function extractAndroidUsage(entry: any): { input_tokens: number; output_tokens: number } | undefined {
  const usage = entry?.extra?.response?.usage;
  if (!usage) {
    return undefined;
  }
  return {
    input_tokens: Number(usage.prompt_tokens || 0),
    output_tokens: Number(usage.completion_tokens || 0),
  };
}

function sumAndroidTokens(messages: any[]): number | undefined {
  const total = messages.reduce((sum, entry) => {
    const usage = entry?.extra?.response?.usage;
    return sum + Number(usage?.total_tokens || 0);
  }, 0);
  return total > 0 ? total : undefined;
}

function parseTaggedObservation(content: string): { returnCode: number | null; output: string; raw: string } {
  const returnCodeMatch = content.match(/<returncode>(-?\d+)<\/returncode>/i);
  const outputMatch = content.match(/<output>\n?([\s\S]*?)<\/output>/i);
  return {
    returnCode: returnCodeMatch ? Number(returnCodeMatch[1]) : null,
    output: outputMatch ? outputMatch[1] : '',
    raw: content,
  };
}

function extractTerminalUsage(metrics: any): { input_tokens: number; output_tokens: number } | undefined {
  if (!metrics) {
    return undefined;
  }
  const prompt = Number(metrics.prompt_tokens || 0);
  const completion = Number(metrics.completion_tokens || 0);
  if (prompt === 0 && completion === 0) {
    return undefined;
  }
  return {
    input_tokens: prompt,
    output_tokens: completion,
  };
}

function extractTerminalTotalTokens(steps: any[]): number | undefined {
  const total = steps.reduce((sum, step) => {
    const metrics = step.metrics || {};
    return sum + Number(metrics.prompt_tokens || 0) + Number(metrics.completion_tokens || 0);
  }, 0);
  return total > 0 ? total : undefined;
}

function mapTerminalTool(name: string, args: Record<string, any>): { name: string; input: Record<string, any> } {
  const normalized = String(name || '');
  const lower = normalized.toLowerCase();
  if (lower.includes('bash') || lower.includes('shell') || lower.includes('command')) {
    return {
      name: 'Bash',
      input: { command: args.command || args.cmd || JSON.stringify(args) },
    };
  }
  if (lower.includes('read')) {
    return {
      name: 'Read',
      input: { file_path: args.file_path || args.path || args.filename || '' },
    };
  }
  if (lower.includes('write')) {
    return {
      name: 'Write',
      input: { file_path: args.file_path || args.path || args.filename || '' },
    };
  }
  if (lower.includes('edit') || lower.includes('replace')) {
    return {
      name: 'Edit',
      input: { file_path: args.file_path || args.path || args.filename || '' },
    };
  }
  if (lower.includes('glob') || lower.includes('search') || lower.includes('find')) {
    return {
      name: 'Glob',
      input: args,
    };
  }
  return {
    name: normalized || 'Tool',
    input: args,
  };
}

function extractTerminalObservation(result: any, stepExtra: any): string {
  if (typeof result?.content === 'string' && !/^\$\d+$/.test(result.content)) {
    return result.content;
  }

  const metadata =
    stepExtra?.tool_result_metadata ||
    stepExtra?.metadata ||
    stepExtra?.tool_result ||
    result?.metadata ||
    {};

  const nestedContent =
    metadata?.tool_use_result?.file?.content ||
    metadata?.tool_use_result?.content ||
    metadata?.raw_tool_result?.content;

  if (typeof nestedContent === 'string' && nestedContent.length > 0) {
    return nestedContent;
  }

  return typeof result?.content === 'string' ? result.content : JSON.stringify(result || {});
}

function detectErrorFromTerminalResult(result: any): boolean | undefined {
  const text = typeof result?.content === 'string' ? result.content : JSON.stringify(result || {});
  return detectErrorFromText(text);
}

function mapSweBenchAction(action: string, state: Record<string, any>): { name: string; input: Record<string, any> } {
  const trimmed = action.trim();
  if (trimmed === 'submit') {
    return { name: 'Bash', input: { command: 'submit' } };
  }

  if (trimmed.startsWith('create ')) {
    const target = trimmed.slice('create '.length).trim().split(/\s+/)[0];
    return { name: 'Write', input: { file_path: target } };
  }

  if (trimmed.startsWith('edit ')) {
    return {
      name: 'Edit',
      input: {
        file_path: String(state.open_file || ''),
        patch: trimmed,
      },
    };
  }

  if (trimmed.startsWith('open ')) {
    return {
      name: 'Read',
      input: {
        file_path: trimmed.slice('open '.length).trim(),
      },
    };
  }

  return {
    name: 'Bash',
    input: {
      command: trimmed,
      cwd: state.working_dir,
    },
  };
}

function parseJsonObject(raw: any): Record<string, any> {
  if (raw && typeof raw === 'object') {
    return raw;
  }
  if (typeof raw !== 'string') {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function detectErrorFromText(text: string): boolean | undefined {
  if (!text) {
    return undefined;
  }

  const lowered = text.toLowerCase();
  if (
    lowered.includes('traceback') ||
    lowered.includes('importerror') ||
    lowered.includes('modulenotfounderror') ||
    lowered.includes('exception') ||
    lowered.includes('error:') ||
    lowered.includes('failed')
  ) {
    return true;
  }

  return false;
}

function safeParseTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function toEpochMs(index: number): number {
  return 1_700_000_000_000 + index * 1000;
}

function basenameWithoutExt(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}

function lookupAndroidBenchScore(filePath: string, taskId: string): any {
  const runDir = path.resolve(path.dirname(filePath), '..');
  if (!androidScoresCache.has(runDir)) {
    const index: Record<string, any> = {};
    for (const entry of fs.readdirSync(runDir)) {
      if (!entry.endsWith('_scores.json')) {
        continue;
      }
      const scorePath = path.join(runDir, entry);
      try {
        const parsed = JSON.parse(fs.readFileSync(scorePath, 'utf-8'));
        for (const [instanceId, value] of Object.entries(parsed)) {
          index[instanceId] = value;
        }
      } catch {
        // Ignore broken score files and fall back to trajectory metadata.
      }
    }
    androidScoresCache.set(runDir, index);
  }

  return androidScoresCache.get(runDir)?.[taskId];
}

function parseCost(value: any): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.replace(/[^0-9.]+/g, '');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function lookupSweBenchOutcome(filePath: string, taskId: string): { success?: boolean; status?: string } {
  const submissionDir = path.resolve(path.dirname(filePath), '..');
  if (!sweResultsCache.has(submissionDir)) {
    const resultsPath = path.join(submissionDir, 'results', 'results.json');
    const index: Record<string, string[]> = {};
    try {
      const parsed = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));
      for (const [key, value] of Object.entries(parsed)) {
        if (Array.isArray(value)) {
          index[key] = value.map(String);
        }
      }
    } catch {
      // Ignore missing results and keep trajectory-only metadata.
    }
    sweResultsCache.set(submissionDir, index);
  }

  const results = sweResultsCache.get(submissionDir) || {};
  if ((results.resolved || []).includes(taskId)) {
    return { success: true, status: 'resolved' };
  }
  if ((results.no_generation || []).includes(taskId)) {
    return { success: false, status: 'no_generation' };
  }
  if ((results.no_logs || []).includes(taskId)) {
    return { success: false, status: 'no_logs' };
  }
  return { success: false, status: 'unresolved' };
}
