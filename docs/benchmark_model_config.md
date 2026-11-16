# Benchmark Model Configuration

Unified configuration file:

- [config/benchmark-model.config.yaml](./config/benchmark-model.config.yaml)

Rendering command:

```bash
npx ts-node scripts/render-benchmark-run-configs.ts
```

Rendering produces:

- `output/benchmark-run-configs/android-bench/`
- `output/benchmark-run-configs/terminal-bench/`
- `output/benchmark-run-configs/swe-bench-verified/`

## What You Need to Change

At minimum, change only these three entries:

```yaml
model:
  base_url: "https://api.example.com/v1"
  api_key: "your-key"
  model: "qwen3-coder-plus"
```

If you want to specify which delegation chain the local `acoder` follows, additionally change:

```yaml
acoder:
  enabled: true
  bin: "acoder"
  agent: "auto"
```

Default behavior:

- at benchmark runtime, the safety confirmation option `1` is automatically fed to `acoder`
- this serves to get past the trust folder prompt shown when the workspace is entered for the first time, preventing the benchmark from stalling on an interactive confirmation

Rules for `acoder.agent=auto`:

- Claude models -> `claude`
- Qwen models -> `opencode`
- GPT / OpenAI models -> `codex`

Permitted values:

- `codex`
- `claude`
- `opencode`
- `qoder`

## Preparation Before Running

### AndroidBench

Before the first run, complete AndroidBench's own initialization:

```bash
cd ~/android-bench
uv venv
source .venv/bin/activate
uv run setup_env
```

### TerminalBench

First confirm that Docker is working:

```bash
docker info
```

If this fails, start Docker Desktop first.

## Actual Behavior of the Three Benchmarks

### AndroidBench

Generated files:

- `env.sh`
- `androidbench.generated.yaml`
- `acoder_android_model.py`
- `launch.sh`

Run:

```bash
bash output/benchmark-run-configs/android-bench/launch.sh
```

Notes:

- the launch script first detects the local `acoder`
- if `acoder` raises a safety confirmation on first entering the current workspace, the generated bridge selects `1. Yes, I trust this folder` by default
- it still goes through AndroidBench's official `uv run python harness/inference/androidbench.py`
- but the model backend is swapped for the generated `AcoderMiniSweAgentModel`
- therefore AndroidBench's native trajectories, patches, and output directories are still preserved

### TerminalBench

Generated files:

- `env.sh`
- `acoder_terminal_agent.py`
- `launch.sh`

Run:

```bash
bash output/benchmark-run-configs/terminal-bench/launch.sh
```

Notes:

- the launch script first:
  - runs `unset VIRTUAL_ENV`
  - detects the local `acoder`
  - checks the Docker CLI / daemon
- when `acoder` is invoked inside the container, the trust folder prompt is likewise confirmed by default
- it then injects a custom TerminalBench agent via
  `--agent-import-path acoder_terminal_agent:AcoderTerminalBenchAgent`
- this agent installs, inside the client container, the same version of `acoder` as on the host machine

If you previously ran into:

- `VIRTUAL_ENV ... does not match the project environment path .venv`
- `Docker daemon is not running`
- the `play-zork` 60-second test timeout

the current generator already handles these:

- automatic `unset VIRTUAL_ENV`
- automatic Docker preflight check
- support for `benchmarks.terminal_bench.global_test_timeout_sec`

For example:

```yaml
benchmarks:
  terminal_bench:
    global_test_timeout_sec: 180
```

### SWE-bench-Verified

Generated files:

- `env.sh`
- `swebench_verified_runner.py`
- `runner-manifest.json`
- `launch.sh`

Run:

```bash
bash output/benchmark-run-configs/swe-bench-verified/launch.sh
```

Notes:

- the launch script first detects the local `acoder`
- when the runner invokes `acoder`, the trust folder prompt is confirmed by default
- the generated runner uses the `instance_questions.json` pointed to by `questions_path` as the master table of the 500 problems
- `projects_root` is solely responsible for supplying the code repository directory of the corresponding instance
- for each instance, it will:
  - execute directly inside the project directory corresponding to `projects_root/<instance_id>`
  - not clone or worktree the project into the current evaluation project directory
  - pass only the verbatim `problem_statement` of that instance from `instance_questions.json` to the local `acoder`
  - the actual command form executed is: `acoder -y -- "<problem_statement>"`
  - carry out the fix with the local `acoder` inside the original project directory
  - save `prompt.txt`, `acoder.stdout.txt`, `acoder.stderr.txt`, `result_patch.diff`, and `record.json`
  - copy the `jsonl` produced by the agent for that task into `runs/<instance_id>/jsonl/`
  - if the original project directory is not itself in a clean git state, automatically run `git stash --include-untracked` first
  - the stash information is written to `preexisting_stash_ref` and `preexisting_stash_message` in `record.json`

The two key paths in the default configuration:

```yaml
benchmarks:
  swe_bench_verified:
    projects_root: "~/Desktop/C_Project/ProcBenck_Dataset/swebench_verified_projects/projects"
    questions_path: "~/Desktop/C_Project/ProcBenck_Dataset/swebench_verified_projects/instance_questions.json"
```

Boundaries of authenticity:

- what is provided here is already an executable local `acoder` runner
- however, the current repository does not bundle the full official SWE-bench environment build together with the resolved-rate evaluation harness
- accordingly, what is standardized here is the execution process and the retention of artifacts; no official resolved metric is claimed

## Replacing the Model

If you change the model to:

```yaml
model:
  model: "gpt-4-turbo-128k"
```

then after re-rendering:

- AndroidBench continues to go through `AcoderMiniSweAgentModel`
- TerminalBench automatically switches the delegate agent to `codex`
- the SWE-bench-Verified runner passes the new model name to the local `acoder`

## Where the Output Goes

Rendering output:

- `output/benchmark-run-configs/<benchmark>/`

Run output:

- AndroidBench: AndroidBench's native `out/<run_name>/...`
- TerminalBench: TerminalBench's `runs/`, or the `output_path` given in the configuration
- SWE-bench-Verified: `output/benchmark-run-configs/swe-bench-verified/runs/<instance_id>/`

Each SWE per-instance directory now contains at least:

- `prompt.txt`
- `acoder.stdout.txt`
- `acoder.stderr.txt`
- `result_patch.diff`
- `record.json`
- `jsonl/`

## Security Notes

- Do not commit a real `api_key` into the repository
- Replacing it with an environment variable placeholder is recommended, e.g. `${PROC_BENCH_API_KEY}`
