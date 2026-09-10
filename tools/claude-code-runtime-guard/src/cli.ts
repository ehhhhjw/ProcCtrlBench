#!/usr/bin/env node
import * as fs from 'fs';
import { loadGuardConfig } from './config';
import { RuntimeGuardEngine } from './guard-engine';
import { HookProcessor } from './hook-processor';
import { HookPayload } from './types';
import { TranscriptWatcher } from './transcript-watcher';

function getArgValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1 || index === args.length - 1) {
    return undefined;
  }
  return args[index + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

async function runAnalyze(args: string[]): Promise<number> {
  const sessionPath = getArgValue(args, '--session');
  if (!sessionPath) {
    throw new Error('Missing --session');
  }

  const config = loadGuardConfig(getArgValue(args, '--config'));
  const engine = new RuntimeGuardEngine();
  const result = await engine.analyze(
    {
      transcriptPath: sessionPath,
      hookEventName: getArgValue(args, '--hook-event'),
      cwd: getArgValue(args, '--cwd'),
    },
    config
  );

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.shouldBlock ? 2 : 0;
}

async function runHook(args: string[]): Promise<number> {
  const config = loadGuardConfig(getArgValue(args, '--config'));
  const input = fs.readFileSync(0, 'utf-8');
  const payload = JSON.parse(input) as HookPayload;
  const processor = new HookProcessor(config);
  const result = await processor.processHook(payload);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.shouldBlock ? 2 : 0;
}

async function runWatch(args: string[]): Promise<number> {
  const sessionPath = getArgValue(args, '--session');
  if (!sessionPath) {
    throw new Error('Missing --session');
  }

  const config = loadGuardConfig(getArgValue(args, '--config'));
  const engine = new RuntimeGuardEngine();

  if (hasFlag(args, '--once')) {
    const result = await engine.analyze({ transcriptPath: sessionPath }, config);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }

  const watcher = new TranscriptWatcher({
    watchSubagents: config.runtime.transport.watchSubagents,
    onUpdate: async (transcriptPath) => {
      const result = await engine.analyze({ transcriptPath }, config);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    },
  });

  watcher.watch(sessionPath);
  process.stdout.write(`watching ${sessionPath}\n`);
  return await new Promise<number>(() => undefined);
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const [command, ...args] = argv;

  switch (command) {
    case 'analyze':
      return runAnalyze(args);
    case 'hook':
      return runHook(args);
    case 'watch':
      return runWatch(args);
    default:
      process.stderr.write('Usage: cc-guard <analyze|hook|watch> [options]\n');
      return 1;
  }
}

if (require.main === module) {
  void main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
