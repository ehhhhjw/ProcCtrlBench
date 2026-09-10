# Claude Code Runtime Guard

这是面向 Claude Code CLI 的独立运行时守护组件。它不改 Claude Code 内部源码，而是通过 transcript `jsonl`、hooks 事件和当前仓库已有的 11 个基准 detector，在执行过程中输出缺陷告警、阻断意见和修正提示。

当前目录提供：

- 运行时代码：
  - [src/index.ts](./tools/claude-code-runtime-guard/src/index.ts)
- CLI 入口：
  - [src/cli.ts](./tools/claude-code-runtime-guard/src/cli.ts)
- Hook bridge：
  - [src/hook-bridge.ts](./tools/claude-code-runtime-guard/src/hook-bridge.ts)
- Settings 安装器：
  - [src/settings-installer.ts](./tools/claude-code-runtime-guard/src/settings-installer.ts)
- 一键包装脚本：
  - [bin/cc-guard](./tools/claude-code-runtime-guard/bin/cc-guard)
  - [bin/cc-guard-hook](./tools/claude-code-runtime-guard/bin/cc-guard-hook)
  - [bin/claude-with-guard](./tools/claude-code-runtime-guard/bin/claude-with-guard)
  - [bin/acoder-claude-with-guard](./tools/claude-code-runtime-guard/bin/acoder-claude-with-guard)
- 配置模板：
  - [guard.config.example.json](./tools/claude-code-runtime-guard/guard.config.example.json)
- Claude settings 模板：
  - [examples/settings.local.json](./tools/claude-code-runtime-guard/examples/settings.local.json)
- 方案文档：
  - [docs/claude_code_runtime_guard.md](./docs/claude_code_runtime_guard.md)

## 已实现能力

- 11 个基准全部支持运行时治理
- 配置文件逐项开关
- `jsonl` 全量重算 + 运行时冷却抑制
- hook 模式
- watcher 模式
- prompt remediation 注入建议生成

## 运行方式

先构建：

```bash
npm run build
```

一次性分析：

```bash
./tools/claude-code-runtime-guard/bin/cc-guard analyze \
  --config ./tools/claude-code-runtime-guard/guard.config.example.json \
  --session ./ClaudeCodeStructure/tests/sample.jsonl
```

hook 模式：

```bash
cat hook-payload.json | ./tools/claude-code-runtime-guard/bin/cc-guard hook \
  --config ./tools/claude-code-runtime-guard/guard.config.example.json
```

watch 模式：

```bash
./tools/claude-code-runtime-guard/bin/cc-guard watch \
  --config ./tools/claude-code-runtime-guard/guard.config.example.json \
  --session ./ClaudeCodeStructure/tests/sample.jsonl
```

一键把 hooks 安装到当前项目：

```bash
./tools/claude-code-runtime-guard/bin/claude-with-guard \
  --config ./tools/claude-code-runtime-guard/guard.config.example.json \
  --install-only
```

安装时会把你传入的配置文件同步复制到目标项目的 `.claude/` 目录，并让 hook 优先使用项目内这份副本。这样不同项目可以并发运行且保持各自独立的 guard 配置。

安装后直接用 guard 包装 Claude：

```bash
./tools/claude-code-runtime-guard/bin/claude-with-guard \
  --config ./tools/claude-code-runtime-guard/guard.config.example.json
```

如果你的 Claude Code 是通过 `acoder` 封装启动：

```bash
./tools/claude-code-runtime-guard/bin/acoder-claude-with-guard \
  --config ./tools/claude-code-runtime-guard/guard.config.example.json \
  -- --continue
```

或显式使用 launcher：

```bash
./tools/claude-code-runtime-guard/bin/claude-with-guard \
  --launcher acoder-claude \
  --config ./tools/claude-code-runtime-guard/guard.config.example.json \
  -- --continue
```

可选的 acoder 参数：

- `--acoder-yolo`
- `--acoder-model <name>`
- `--acoder-debug`
- `--acoder-no-banner`
- `--acoder-no-upgrade`

说明：

- `claude-with-guard` 会先把 hooks 合并写入当前项目的 `.claude/settings.local.json`
- 同时会把 `--config` 指定的 guard 配置复制到当前项目的 `.claude/` 目录，再让 hook 指向这份项目内配置
- 然后再启动 `claude`
- hook 执行时会调用 `cc-guard-hook`
- `cc-guard-hook` 会把 11 个基准的告警转换成 Claude Code 可识别的 hook 返回

## 测试

```bash
npm test
```
