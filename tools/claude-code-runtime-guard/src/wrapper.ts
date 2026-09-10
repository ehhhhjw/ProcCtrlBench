#!/usr/bin/env node
import * as path from 'path';
import { spawn } from 'child_process';
import { installClaudeRuntimeGuardHooks } from './settings-installer';

type LauncherMode = 'claude' | 'acoder-claude';

function getArgValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1 || index === args.length - 1) {
    return undefined;
  }
  return args[index + 1];
}

function consumeFlag(args: string[], flag: string): string[] {
  const index = args.indexOf(flag);
  if (index === -1) {
    return args;
  }
  const next = [...args];
  next.splice(index, 1);
  return next;
}

function consumeFlagWithValue(args: string[], flag: string): string[] {
  const index = args.indexOf(flag);
  if (index === -1) {
    return args;
  }
  const next = [...args];
  next.splice(index, 2);
  return next;
}

function splitPassthroughArgs(args: string[]): { wrapperArgs: string[]; passthroughArgs: string[] } {
  const separatorIndex = args.indexOf('--');
  if (separatorIndex === -1) {
    return {
      wrapperArgs: [...args],
      passthroughArgs: [],
    };
  }

  return {
    wrapperArgs: args.slice(0, separatorIndex),
    passthroughArgs: args.slice(separatorIndex + 1),
  };
}

export function buildLaunchSpec(
  rawArgs: string[],
  defaults?: {
    defaultLauncher?: LauncherMode;
  }
): { command: string; args: string[] } {
  const { wrapperArgs, passthroughArgs } = splitPassthroughArgs(rawArgs);
  const launcher = (getArgValue(wrapperArgs, '--launcher') as LauncherMode | undefined) ||
    defaults?.defaultLauncher ||
    'claude';

  let cleanedArgs = [...wrapperArgs];
  cleanedArgs = consumeFlagWithValue(cleanedArgs, '--config');
  cleanedArgs = consumeFlagWithValue(cleanedArgs, '--project-dir');
  cleanedArgs = consumeFlagWithValue(cleanedArgs, '--claude-bin');
  cleanedArgs = consumeFlagWithValue(cleanedArgs, '--launcher');
  cleanedArgs = consumeFlagWithValue(cleanedArgs, '--acoder-bin');
  cleanedArgs = consumeFlagWithValue(cleanedArgs, '--acoder-model');
  cleanedArgs = consumeFlag(cleanedArgs, '--acoder-yolo');
  cleanedArgs = consumeFlag(cleanedArgs, '--acoder-debug');
  cleanedArgs = consumeFlag(cleanedArgs, '--acoder-no-banner');
  cleanedArgs = consumeFlag(cleanedArgs, '--acoder-no-upgrade');
  cleanedArgs = consumeFlag(cleanedArgs, '--install-only');

  const downstreamArgs = passthroughArgs.length > 0 ? passthroughArgs : cleanedArgs;

  if (launcher === 'acoder-claude') {
    const acoderBin = getArgValue(wrapperArgs, '--acoder-bin') || 'acoder';
    const acoderArgs = ['--agent', 'claude'];

    const acoderModel = getArgValue(wrapperArgs, '--acoder-model');
    if (acoderModel) {
      acoderArgs.push('--model', acoderModel);
    }
    if (wrapperArgs.includes('--acoder-yolo')) {
      acoderArgs.push('--yolo');
    }
    if (wrapperArgs.includes('--acoder-debug')) {
      acoderArgs.push('--debug');
    }
    if (wrapperArgs.includes('--acoder-no-banner')) {
      acoderArgs.push('--no-banner');
    }
    if (wrapperArgs.includes('--acoder-no-upgrade')) {
      acoderArgs.push('--no-upgrade');
    }

    if (downstreamArgs.length > 0) {
      acoderArgs.push('--', ...downstreamArgs);
    }

    return {
      command: acoderBin,
      args: acoderArgs,
    };
  }

  return {
    command: getArgValue(wrapperArgs, '--claude-bin') || 'claude',
    args: downstreamArgs,
  };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const repoRoot = path.resolve(__dirname, '../../../../');
  const configPath = path.resolve(
    getArgValue(argv, '--config') ||
      path.join(repoRoot, 'tools/claude-code-runtime-guard/guard.config.json')
  );
  const targetDir = path.resolve(getArgValue(argv, '--project-dir') || process.cwd());
  const installOnly = argv.includes('--install-only');

  installClaudeRuntimeGuardHooks({
    repoRoot,
    configPath,
    targetDir,
  });

  if (installOnly) {
    process.stdout.write(`Installed Claude hooks into ${path.join(targetDir, '.claude/settings.local.json')}\n`);
    return 0;
  }

  const launchSpec = buildLaunchSpec(argv);

  return await new Promise<number>((resolve, reject) => {
    const child = spawn(launchSpec.command, launchSpec.args, {
      stdio: 'inherit',
      cwd: targetDir,
      env: process.env,
    });

    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

if (require.main === module) {
  void main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
