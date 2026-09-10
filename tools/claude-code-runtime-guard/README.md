# Claude Code Runtime Guard

This is a standalone runtime guard for the Claude Code CLI. It does not modify Claude Code's internal source code. Instead, it uses transcript `jsonl`, hook events, and the 11 benchmark detectors already in this repository to provide defect warnings, blocking recommendations, and remediation guidance during execution.

This directory provides:

- Runtime code:
  - [src/index.ts](./tools/claude-code-runtime-guard/src/index.ts)
- CLI entry point:
  - [src/cli.ts](./tools/claude-code-runtime-guard/src/cli.ts)
- Hook bridge:
  - [src/hook-bridge.ts](./tools/claude-code-runtime-guard/src/hook-bridge.ts)
- Settings installer:
  - [src/settings-installer.ts](./tools/claude-code-runtime-guard/src/settings-installer.ts)
- Wrapper scripts:
  - [bin/cc-guard](./tools/claude-code-runtime-guard/bin/cc-guard)
  - [bin/cc-guard-hook](./tools/claude-code-runtime-guard/bin/cc-guard-hook)
  - [bin/claude-with-guard](./tools/claude-code-runtime-guard/bin/claude-with-guard)
  - [bin/acoder-claude-with-guard](./tools/claude-code-runtime-guard/bin/acoder-claude-with-guard)
- Configuration template:
  - [guard.config.example.json](./tools/claude-code-runtime-guard/guard.config.example.json)
- Claude settings template:
  - [examples/settings.local.json](./tools/claude-code-runtime-guard/examples/settings.local.json)
- Design document:
  - [docs/claude_code_runtime_guard.md](./docs/claude_code_runtime_guard.md)

## Implemented Features

- Runtime governance for all 11 benchmarks
- Per-item configuration toggles
- Full `jsonl` recomputation with runtime cooldown suppression
- hook mode
- watcher mode
- prompt remediation injection recommendation generation

## Usage

Build first:

```bash
npm run build
```

One-time analysis:

```bash
./tools/claude-code-runtime-guard/bin/cc-guard analyze \
  --config ./tools/claude-code-runtime-guard/guard.config.example.json \
  --session ./ClaudeCodeStructure/tests/sample.jsonl
```

hook mode:

```bash
cat hook-payload.json | ./tools/claude-code-runtime-guard/bin/cc-guard hook \
  --config ./tools/claude-code-runtime-guard/guard.config.example.json
```

watch mode:

```bash
./tools/claude-code-runtime-guard/bin/cc-guard watch \
  --config ./tools/claude-code-runtime-guard/guard.config.example.json \
  --session ./ClaudeCodeStructure/tests/sample.jsonl
```

Install hooks in the current project with one command:

```bash
./tools/claude-code-runtime-guard/bin/claude-with-guard \
  --config ./tools/claude-code-runtime-guard/guard.config.example.json \
  --install-only
```

During installation, the provided configuration file is copied to the target project's `.claude/` directory, and the hook prioritizes this project-local copy. This allows multiple projects to run concurrently with independent guard configurations.

After installation, launch Claude through the guard wrapper:

```bash
./tools/claude-code-runtime-guard/bin/claude-with-guard \
  --config ./tools/claude-code-runtime-guard/guard.config.example.json
```

If your Claude Code is launched through an `acoder` wrapper:

```bash
./tools/claude-code-runtime-guard/bin/acoder-claude-with-guard \
  --config ./tools/claude-code-runtime-guard/guard.config.example.json \
  -- --continue
```

Or explicitly specify the launcher:

```bash
./tools/claude-code-runtime-guard/bin/claude-with-guard \
  --launcher acoder-claude \
  --config ./tools/claude-code-runtime-guard/guard.config.example.json \
  -- --continue
```

Optional acoder arguments:

- `--acoder-yolo`
- `--acoder-model <name>`
- `--acoder-debug`
- `--acoder-no-banner`
- `--acoder-no-upgrade`

Notes:

- `claude-with-guard` first merges the hooks into the current project's `.claude/settings.local.json`
- It also copies the guard configuration specified by `--config` to the current project's `.claude/` directory, then points the hook to this project-local configuration
- It then launches `claude`
- The hook invokes `cc-guard-hook` during execution
- `cc-guard-hook` converts warnings from the 11 benchmarks into hook responses recognized by Claude Code

## Testing

```bash
npm test
```
