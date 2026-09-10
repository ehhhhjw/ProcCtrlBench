import * as fs from 'fs';
import * as path from 'path';

export interface HookInstallOptions {
  repoRoot: string;
  configPath: string;
  targetDir?: string;
  targetSettingsPath?: string;
  statusMessage?: string;
}

type HookCommandConfig = {
  type: 'command';
  command: string;
  timeout?: number;
  statusMessage?: string;
};

type HookMatcherEntry = {
  matcher?: string;
  hooks: HookCommandConfig[];
};

type ClaudeSettings = {
  hooks?: Record<string, HookMatcherEntry[]>;
  [key: string]: unknown;
};

const GUARDED_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PreCompact',
  'Stop',
  'SubagentStart',
  'SubagentStop',
] as const;

function readSettings(settingsPath: string): ClaudeSettings {
  if (!fs.existsSync(settingsPath)) {
    return {};
  }

  const raw = fs.readFileSync(settingsPath, 'utf-8').trim();
  if (!raw) {
    return {};
  }

  return JSON.parse(raw) as ClaudeSettings;
}

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function installProjectLocalConfig(targetDir: string, configPath: string): string {
  const sourcePath = path.resolve(configPath);
  const targetPath = path.join(targetDir, '.claude', path.basename(sourcePath));

  ensureDir(targetPath);
  if (sourcePath !== targetPath) {
    fs.copyFileSync(sourcePath, targetPath);
  }

  return targetPath;
}

function mergeHookEntries(existing: HookMatcherEntry[], incoming: HookMatcherEntry): HookMatcherEntry[] {
  const next = [...existing];
  const found = next.find((entry) => (entry.matcher || '') === (incoming.matcher || ''));

  if (!found) {
    next.push(incoming);
    return next;
  }

  for (const hook of incoming.hooks) {
    const hasCommand = found.hooks.some(
      (candidate) => candidate.type === hook.type && candidate.command === hook.command
    );
    if (!hasCommand) {
      found.hooks.push(hook);
    }
  }

  return next;
}

export function buildHookCommand(repoRoot: string, configPath: string): string {
  const hookScript = path.resolve(repoRoot, 'tools/claude-code-runtime-guard/bin/cc-guard-hook');
  return `${hookScript} --config ${path.resolve(configPath)}`;
}

export function installClaudeRuntimeGuardHooks(options: HookInstallOptions): string {
  const repoRoot = path.resolve(options.repoRoot);
  const configPath = path.resolve(options.configPath);
  const targetDir = path.resolve(options.targetDir || process.cwd());
  const settingsPath = path.resolve(
    options.targetSettingsPath || path.join(targetDir, '.claude', 'settings.local.json')
  );
  const settings = readSettings(settingsPath);
  const installedConfigPath = installProjectLocalConfig(targetDir, configPath);
  const hookCommand = buildHookCommand(repoRoot, installedConfigPath);
  const hook: HookCommandConfig = {
    type: 'command',
    command: hookCommand,
    timeout: 120,
    statusMessage: options.statusMessage || 'Runtime guard checking execution risks...',
  };

  if (!settings.hooks) {
    settings.hooks = {};
  }

  for (const eventName of GUARDED_EVENTS) {
    const current = settings.hooks[eventName] || [];
    settings.hooks[eventName] = mergeHookEntries(current, { hooks: [hook] });
  }

  ensureDir(settingsPath);
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8');
  return settingsPath;
}
