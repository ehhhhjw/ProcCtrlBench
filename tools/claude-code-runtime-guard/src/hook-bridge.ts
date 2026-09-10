#!/usr/bin/env node
import * as fs from 'fs';
import { loadGuardConfig } from './config';
import { HookProcessor } from './hook-processor';
import { GuardAlert, HookPayload } from './types';

interface ClaudeHookResponse {
  continue?: boolean;
  stopReason?: string;
  suppressOutput?: boolean;
  decision?: 'block';
  reason?: string;
  systemMessage?: string;
  hookSpecificOutput?: {
    hookEventName: string;
    additionalContext?: string;
    permissionDecision?: 'allow' | 'deny' | 'ask';
    permissionDecisionReason?: string;
    updatedInput?: unknown;
  };
}

function getArgValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1 || index === args.length - 1) {
    return undefined;
  }
  return args[index + 1];
}

function summarizeAlerts(alerts: GuardAlert[]): string | undefined {
  if (alerts.length === 0) {
    return undefined;
  }

  const top = alerts.slice(0, 3).map((alert) => `${alert.benchmark}: ${alert.summary}`);
  return top.join('\n');
}

function buildAdditionalContext(result: {
  injections: Array<{ benchmark: string; prompt: string }>;
  alerts: GuardAlert[];
}): string | undefined {
  const lines: string[] = [];

  for (const injection of result.injections) {
    lines.push(`[RuntimeGuard/${injection.benchmark}] ${injection.prompt}`);
  }

  if (lines.length === 0 && result.alerts.length > 0) {
    for (const alert of result.alerts.slice(0, 2)) {
      if (alert.suggestion) {
        lines.push(`[RuntimeGuard/${alert.benchmark}] ${alert.suggestion}`);
      }
    }
  }

  if (lines.length === 0) {
    return undefined;
  }

  return lines.join('\n');
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const config = loadGuardConfig(getArgValue(argv, '--config'));
  const input = fs.readFileSync(0, 'utf-8');
  const payload = JSON.parse(input) as HookPayload;
  const processor = new HookProcessor(config);
  const result = await processor.processHook(payload);

  const response: ClaudeHookResponse = {};
  const systemMessage = summarizeAlerts(result.alerts);
  const additionalContext = buildAdditionalContext(result);

  if (systemMessage) {
    response.systemMessage = systemMessage;
  }

  if (payload.hook_event_name) {
    response.hookSpecificOutput = {
      hookEventName: payload.hook_event_name,
    };

    if (additionalContext) {
      response.hookSpecificOutput.additionalContext = additionalContext;
    }
  }

  if (result.shouldBlock) {
    const reason = result.blockReasons.join('; ');
    response.reason = reason;

    if (payload.hook_event_name === 'PreToolUse') {
      response.hookSpecificOutput = {
        ...(response.hookSpecificOutput || { hookEventName: 'PreToolUse' }),
        hookEventName: 'PreToolUse',
        additionalContext,
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      };
    } else {
      response.continue = false;
      response.decision = 'block';
      response.stopReason = reason;
    }
  }

  process.stdout.write(`${JSON.stringify(response)}\n`);
  return result.shouldBlock ? 2 : 0;
}

if (require.main === module) {
  void main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    const fallback: ClaudeHookResponse = {
      systemMessage: `cc-guard-hook failed: ${error instanceof Error ? error.message : String(error)}`,
    };
    process.stdout.write(`${JSON.stringify(fallback)}\n`);
    process.exitCode = 1;
  });
}
