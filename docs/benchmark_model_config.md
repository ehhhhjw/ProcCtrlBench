# Benchmark 模型配置

统一配置文件：

- [config/benchmark-model.config.yaml](./config/benchmark-model.config.yaml)

渲染命令：

```bash
npx ts-node scripts/render-benchmark-run-configs.ts
```

渲染后会生成：

- `output/benchmark-run-configs/android-bench/`
- `output/benchmark-run-configs/terminal-bench/`
- `output/benchmark-run-configs/swe-bench-verified/`

## 你需要改什么

最少只改这三项：

```yaml
model:
  base_url: "https://api.example.com/v1"
  api_key: "your-key"
  model: "qwen3-coder-plus"
```

如果你要指定本地 `acoder` 走哪条代理链，再改：

```yaml
acoder:
  enabled: true
  bin: "acoder"
  agent: "auto"
```

默认行为：

- benchmark 运行时会自动向 `acoder` 输入安全确认选项 `1`
- 用于通过首次进入工作区时的 trust folder 提示，避免 benchmark 卡在交互确认上

`acoder.agent=auto` 的规则：

- Claude 模型 -> `claude`
- Qwen 模型 -> `opencode`
- GPT / OpenAI 模型 -> `codex`

可选值：

- `codex`
- `claude`
- `opencode`
- `qoder`

## 运行前准备

### AndroidBench

首次运行前先完成 AndroidBench 自身初始化：

```bash
cd ~/android-bench
uv venv
source .venv/bin/activate
uv run setup_env
```

### TerminalBench

先确认 Docker 正常：

```bash
docker info
```

如果这里失败，先启动 Docker Desktop。

## 三个 benchmark 的实际行为

### AndroidBench

生成文件：

- `env.sh`
- `androidbench.generated.yaml`
- `acoder_android_model.py`
- `launch.sh`

运行：

```bash
bash output/benchmark-run-configs/android-bench/launch.sh
```

说明：

- 启动脚本先检测本地 `acoder`
- 如果 `acoder` 首次进入当前工作区弹出安全确认，生成的 bridge 会默认选择 `1. Yes, I trust this folder`
- 仍然走 AndroidBench 官方 `uv run python harness/inference/androidbench.py`
- 但模型后端换成生成的 `AcoderMiniSweAgentModel`
- 所以 AndroidBench 的原生轨迹、patch、输出目录仍然保留

### TerminalBench

生成文件：

- `env.sh`
- `acoder_terminal_agent.py`
- `launch.sh`

运行：

```bash
bash output/benchmark-run-configs/terminal-bench/launch.sh
```

说明：

- 启动脚本会先：
  - `unset VIRTUAL_ENV`
  - 检测本地 `acoder`
  - 检查 Docker CLI / daemon
- 容器内调用 `acoder` 时也会默认确认 trust folder 提示
- 然后通过 `--agent-import-path acoder_terminal_agent:AcoderTerminalBenchAgent`
  注入一个自定义 TerminalBench agent
- 这个 agent 会在 client container 中安装和本机同版本的 `acoder`

如果你之前遇到：

- `VIRTUAL_ENV ... does not match the project environment path .venv`
- `Docker daemon is not running`
- `play-zork` 60 秒测试超时

当前生成器已经处理：

- 自动 `unset VIRTUAL_ENV`
- 自动 Docker 预检
- 支持 `benchmarks.terminal_bench.global_test_timeout_sec`

例如：

```yaml
benchmarks:
  terminal_bench:
    global_test_timeout_sec: 180
```

### SWE-bench-Verified

生成文件：

- `env.sh`
- `swebench_verified_runner.py`
- `runner-manifest.json`
- `launch.sh`

运行：

```bash
bash output/benchmark-run-configs/swe-bench-verified/launch.sh
```

说明：

- 启动脚本先检测本地 `acoder`
- runner 调用 `acoder` 时会默认确认 trust folder 提示
- 生成的 runner 会以 `questions_path` 指向的 `instance_questions.json` 作为 500 条题目主表
- `projects_root` 只负责提供对应实例的代码仓库目录
- 每个实例会：
  - 直接进入 `projects_root/<instance_id>` 对应项目目录执行
  - 不会把项目 clone 或 worktree 到当前评测项目目录下
  - 只把 `instance_questions.json` 中该实例的 `problem_statement` 原文传给本地 `acoder`
  - 实际执行命令形态是：`acoder -y -- "<problem_statement>"`
  - 用本地 `acoder` 在原始项目目录中执行修复
  - 保存 `prompt.txt`、`acoder.stdout.txt`、`acoder.stderr.txt`、`result_patch.diff`、`record.json`
  - 复制该任务对应 agent 产生的 `jsonl` 到 `runs/<instance_id>/jsonl/`
  - 如果原始项目目录本身不是干净 git 状态，会先自动执行 `git stash --include-untracked`
  - stash 信息会写入 `record.json` 的 `preexisting_stash_ref` 和 `preexisting_stash_message`

默认配置中的两个关键路径：

```yaml
benchmarks:
  swe_bench_verified:
    projects_root: "~/Desktop/C_Project/ProcBenck_Dataset/swebench_verified_projects/projects"
    questions_path: "~/Desktop/C_Project/ProcBenck_Dataset/swebench_verified_projects/instance_questions.json"
```

真实性边界：

- 这里已经是可执行的本地 `acoder` runner
- 但当前仓库没有把官方 SWE-bench 全套环境构建和 resolved-rate 评测 harness 一起打包
- 所以这里标准化的是执行过程和产物留存，不宣称官方 resolved 指标

## 模型替换

如果你把模型改成：

```yaml
model:
  model: "gpt-4-turbo-128k"
```

重新渲染后：

- AndroidBench 继续走 `AcoderMiniSweAgentModel`
- TerminalBench 会自动把 delegate agent 切到 `codex`
- SWE-bench-Verified runner 会把新的模型名传给本地 `acoder`

## 输出在哪里

渲染输出：

- `output/benchmark-run-configs/<benchmark>/`

运行输出：

- AndroidBench：AndroidBench 原生 `out/<run_name>/...`
- TerminalBench：TerminalBench 的 `runs/` 或配置里的 `output_path`
- SWE-bench-Verified：`output/benchmark-run-configs/swe-bench-verified/runs/<instance_id>/`

SWE 每个实例目录现在至少会包含：

- `prompt.txt`
- `acoder.stdout.txt`
- `acoder.stderr.txt`
- `result_patch.diff`
- `record.json`
- `jsonl/`

## 安全说明

- 不要把真实 `api_key` 提交进仓库
- 建议改成环境变量占位，例如 `${PROC_BENCH_API_KEY}`
