# Running One Agent-Model Configuration End to End

This walks through evaluating a single agent-model configuration across the three task sources and
feeding the result into ProcCtrlBench. Repeat it once per configuration you want to compare — the
cross-system tables (Table 2, 6, 8, 10, 12, 14, 15) need one run per system, each with a distinct
`--variant`. The paper's composition is 11 systems / 50 tasks / 200 runs; use
`scripts/sample-paper-corpus.ts` to select and validate it.

## 1. Configure the model

Edit `config/benchmark-model.config.yaml`. Only three fields normally change:

```yaml
model:
  base_url: "https://api.example.com/v1"   # any OpenAI-compatible endpoint
  api_key: "${PROCCTRL_API_KEY}"           # prefer the environment over a literal
  model: "your-model-id"
```

Keep credentials out of version control. Export `PROCCTRL_API_KEY` instead of writing the key into
the file.

Dataset locations can also come from the environment:
`PROCCTRL_ANDROID_BENCH_REPO`, `PROCCTRL_SWEBENCH_PROJECTS_ROOT`, `PROCCTRL_SWEBENCH_QUESTIONS`,
`PROCCTRL_SWEBENCH_EXPERIMENTS_ROOT`.

## 2. Render the run artifacts

```bash
npx ts-node scripts/render-benchmark-run-configs.ts
```

This produces launch scripts under:

- `output/benchmark-run-configs/android-bench/`
- `output/benchmark-run-configs/terminal-bench/`
- `output/benchmark-run-configs/swe-bench-verified/`

## 3. Run the benchmarks

### AndroidBench

One-time initialisation in your AndroidBench checkout:

```bash
cd /path/to/android-bench
uv venv
source .venv/bin/activate
uv run setup_env
```

Then re-render the artifacts (step 2) and launch:

```bash
bash output/benchmark-run-configs/android-bench/launch.sh
```

Native results land in `<android-bench>/out/<run_name>/`, containing `trajectories/`, `patches/`, and
`logs/`. The generated script does not pass `--run-name`, so AndroidBench derives the directory from
the model name plus a timestamp.

### TerminalBench

Requires a running Docker daemon.

```bash
bash output/benchmark-run-configs/terminal-bench/launch.sh
```

Results land in the directory named by `benchmarks.terminal_bench.output_path` (default `runs`,
under the configured `repo_path`).

### SWE-bench-Verified

This repository does not launch a SWE inference scaffold for you. It renders the integration surface:

- `output/benchmark-run-configs/swe-bench-verified/env.sh`
- `output/benchmark-run-configs/swe-bench-verified/runner-manifest.json`
- `output/benchmark-run-configs/swe-bench-verified/launch.template.sh`

Wire those environment variables into an external scaffold such as OpenHands or SWE-agent, and point
the next step at the resulting `.traj` directory.

## 4. Evaluate the trajectories

Give the run a clear system label — it becomes the row key in the cross-system tables.

```bash
PROC_BENCH_DISABLE_TREE_SITTER=1 npx ts-node scripts/run-paper-offline-experiments.ts \
  --android-root  /path/to/android-bench/out \
  --terminal-root /path/to/terminal-bench/runs \
  --swe-root      /path/to/swe-trajectories \
  --output output/runs/my-model \
  --variant "My Agent / my-model" \
  --calibration-profile output/calibration/hierarchical.json \
  --resume true --quiet true --save-reports true
```

Pass only the roots you actually ran; the others can be omitted. `--calibration-profile` is optional
until Step 3 of the reproduction guide has produced a profile; without it the fixed heuristic
posterior-risk model is used.

### What you get

| File | Contents |
|---|---|
| `trajectory-records.jsonl` | One record per trajectory — the input to artifact generation. |
| `trajectory-records.csv` | Same records, flattened for spreadsheets. |
| `observed-benchmark-summary.csv` / `.md` | Per-source descriptive statistics. |
| `defect-failure-correlation-*.csv` | Whether each defect co-occurs with endpoint failure. |
| `swe-control-preservation.csv` | Control-preservation summary for SWE trajectories. |
| `reproduction-status.md` | Which paper artifacts this particular run can support. |
| `reports/…/evaluation-*.json` | Full per-trajectory reports (only with `--save-reports true`). |

Key columns in `trajectory-records.csv`:

- Identity: `variant`, `benchmark`, `taskId`, `trialId`, `status`, `success`
- Cost: `tokens`, `costUsd`
- Scorecard: `qCtx`, `qTool`, `qWf`, `qEco`, `qDef`, `pb` (eta = 0.70), `pbEta`
- Risk: `overallRisk`, `averagePosteriorRisk`, `totalWarnings`, `totalErrors`
- Control: `controlPreservation`, `controlPreservationSource`, `controlPreservationRaw`,
  `controlLevel`, `interpretability`, `interruptibility`, `corrigibility`, `reversibility`,
  `handoffAwareness`
- Per defect: `<defect>PosteriorRisk`, `<defect>Warnings`, `<defect>Errors`, `<defect>Triggered`
- Calibration: `defectSignals`, `defectRisks`, `errorBandDefectCount`

Note the internal control-preservation names: `corrigibility` and `handoffAwareness` correspond to
the paper's **correctability** and **authority handoff**. The renaming happens in the Table 12
output. `controlPreservationSource` should be `paper-appendix-a5` for benchmark runs.

## 5. Build the paper artifacts

```bash
npx ts-node scripts/generate-paper-artifacts.ts \
  --records output/runs/my-model/trajectory-records.jsonl \
  --annotations output/annotations/annotations.json \
  --split output/annotations/split.json \
  --eta 0.70 \
  --output output/paper-artifacts
```

Add `--records a.jsonl,b.jsonl,...` to compare systems. `--annotations` unblocks Tables 1, 4, 5, 7,
13 and Figure 7; `--split` makes Tables 13/14 genuinely held-out. See
[reproducing_paper_results.md](reproducing_paper_results.md).

## Where to look first

1. `artifact-manifest.md` — what was produced, what was blocked and why.
2. `table2-cross-system-scorecard.csv` — the headline comparison.
3. `trajectory-records.csv` — filter for `success=false` with high `overallRisk`, or `success=true`
   with low `controlPreservation`, to find the fragile runs.
4. `fig2a-defect-failure-correlation.csv` — which defect class most tracks failure for this system.
5. `reports/…/evaluation-*.json` — full findings, risk, and control-preservation detail for one run.

## Scope note

The ProcCtrlBench evaluation layer runs on any trajectory directory. The benchmark launchers differ
in maturity: AndroidBench and TerminalBench get executable launch artifacts, while SWE-bench-Verified
gets a standardised integration template rather than a built-in runner.
