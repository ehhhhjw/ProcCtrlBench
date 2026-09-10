const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  installClaudeRuntimeGuardHooks,
} = require('../../dist/tools/claude-code-runtime-guard/src/settings-installer.js');
const {
  main: wrapperMain,
  buildLaunchSpec,
} = require('../../dist/tools/claude-code-runtime-guard/src/wrapper.js');

test('settings installer merges runtime guard hooks into existing project settings', () => {
  const repoRoot = path.resolve(__dirname, '../..');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-install-'));
  const settingsPath = path.join(tempDir, '.claude', 'settings.local.json');
  const sourceConfigPath = path.join(
    repoRoot,
    'tools/claude-code-runtime-guard/guard.config.example.json'
  );
  const copiedConfigPath = path.join(tempDir, '.claude', path.basename(sourceConfigPath));
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(
    settingsPath,
    JSON.stringify(
      {
        env: {
          KEEP_ME: '1',
        },
        hooks: {
          PostToolUse: [
            {
              matcher: 'Write|Edit',
              hooks: [
                {
                  type: 'command',
                  command: 'echo existing',
                },
              ],
            },
          ],
        },
      },
      null,
      2
    )
  );

  const written = installClaudeRuntimeGuardHooks({
    repoRoot,
    configPath: sourceConfigPath,
    targetDir: tempDir,
  });

  const merged = JSON.parse(fs.readFileSync(written, 'utf-8'));
  assert.ok(fs.existsSync(copiedConfigPath));
  assert.equal(fs.readFileSync(copiedConfigPath, 'utf-8'), fs.readFileSync(sourceConfigPath, 'utf-8'));
  assert.equal(merged.env.KEEP_ME, '1');
  assert.ok(Array.isArray(merged.hooks.PreToolUse));
  assert.ok(Array.isArray(merged.hooks.SessionStart));
  assert.ok(
    merged.hooks.PostToolUse.some((entry) =>
      entry.hooks.some(
        (hook) =>
          String(hook.command).includes('cc-guard-hook') &&
          String(hook.command).includes(copiedConfigPath)
      )
    )
  );
  assert.ok(
    merged.hooks.PostToolUse.some((entry) =>
      entry.hooks.some((hook) => hook.command === 'echo existing')
    )
  );
});

test('hook bridge emits Claude-compatible deny response for blocked PreToolUse', () => {
  const repoRoot = path.resolve(__dirname, '../..');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-hook-'));
  const configPath = path.join(tempDir, 'guard.json');
  const transcriptPath = path.join(tempDir, 'dead-step.jsonl');
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        runtime: {
          analysisRootDir: repoRoot,
          actions: {
            blockHighRiskPreToolUse: true,
          },
        },
        benchmarks: {
          deadStep: {
            blockOnError: true,
          },
        },
      },
      null,
      2
    )
  );

  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({
        uuid: 'u1',
        timestamp: 1,
        type: 'message',
        message: {
          type: 'user',
          id: 'msg-1',
          content: [{ type: 'text', text: 'Read foo.py and tell me what it says.' }],
        },
      }),
      JSON.stringify({
        uuid: 'a1',
        timestamp: 2,
        type: 'message',
        message: {
          type: 'assistant',
          id: 'msg-2',
          parentUuid: 'u1',
          content: [
            { type: 'text', text: 'I will inspect the file.' },
            { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'foo.py' } },
          ],
        },
      }),
      JSON.stringify({
        uuid: 'tu1',
        timestamp: 3,
        type: 'tool-use',
        toolUse: {
          id: 'tool-1',
          name: 'Read',
          input: { file_path: 'foo.py' },
          messageId: 'msg-2',
        },
      }),
      JSON.stringify({
        uuid: 'tr1',
        timestamp: 4,
        type: 'tool-result',
        toolResult: {
          tool_use_id: 'tool-1',
          content: 'def helper():\n    return 1\n',
          messageId: 'msg-2',
        },
      }),
      JSON.stringify({
        uuid: 'a2',
        timestamp: 5,
        type: 'message',
        message: {
          type: 'assistant',
          id: 'msg-3',
          parentUuid: 'u1',
          content: [{ type: 'text', text: 'Inspection complete.' }],
        },
      }),
    ].join('\n'),
    'utf-8'
  );

  const payload = JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: 'sample',
    transcript_path: transcriptPath,
    cwd: repoRoot,
    tool_name: 'Read',
    tool_input: {
      file_path: 'foo.py',
    },
  });

  const run = spawnSync(
    'node',
    [
      path.join(repoRoot, 'dist/tools/claude-code-runtime-guard/src/hook-bridge.js'),
      '--config',
      configPath,
    ],
    {
      input: payload,
      encoding: 'utf-8',
    }
  );

  assert.equal(run.status, 2);
  const response = JSON.parse(run.stdout);
  assert.equal(response.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(response.hookSpecificOutput.permissionDecision, 'deny');
  assert.ok(typeof response.hookSpecificOutput.additionalContext === 'string');
});

test('wrapper install-only writes project settings without launching Claude', async () => {
  const repoRoot = path.resolve(__dirname, '../..');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-wrapper-'));
  const sourceConfigPath = path.join(
    repoRoot,
    'tools/claude-code-runtime-guard/guard.config.example.json'
  );
  const exitCode = await wrapperMain([
    '--project-dir',
    tempDir,
    '--config',
    sourceConfigPath,
    '--install-only',
  ]);

  assert.equal(exitCode, 0);
  const settingsPath = path.join(tempDir, '.claude', 'settings.local.json');
  assert.ok(fs.existsSync(settingsPath));
  assert.ok(fs.existsSync(path.join(tempDir, '.claude', path.basename(sourceConfigPath))));
});

test('wrapper builds acoder claude launch spec with passthrough args', () => {
  const spec = buildLaunchSpec([
    '--launcher',
    'acoder-claude',
    '--acoder-yolo',
    '--acoder-model',
    'sonnet',
    '--',
    '--continue',
  ]);

  assert.equal(spec.command, 'acoder');
  assert.deepEqual(spec.args, [
    '--agent',
    'claude',
    '--model',
    'sonnet',
    '--yolo',
    '--',
    '--continue',
  ]);
});
