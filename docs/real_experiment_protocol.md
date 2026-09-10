# ProcBench Real Offline Experiment Protocol

This protocol separately describes the parts of the paper's experiments that the current repository can **genuinely execute** and those that **cannot be strictly reproduced**, so as to avoid writing up missing data as completed results.

## 1. Data Sources

- AndroidBench real trajectory root directory:
  `./external_data/android_bench`
- TerminalBench real trajectory root directory:
  `./external_data/terminal_bench`
- SWE-bench-Verified real trajectory root directory:
  `~/Desktop/swe-bench-experiments/evaluation/verified/20240620_sweagent_claude3.5sonnet/trajs`
- SWE verified project code:
  `~/Desktop/C_Project/swebench_verified_projects/projects`

## 2. Method Pipeline Already Aligned with the Paper

The current repository genuinely implements the following end to end:

`raw trajectory -> unified SessionData / StandardEvent-like view -> 11 detectors -> finding -> posterior risk -> control preservation -> execution guidance -> structured aggregate tables`

Corresponding implementations:

- benchmark trajectory adaptation:
  [src/adapters/BenchmarkTrajectoryLoader.ts](./src/adapters/BenchmarkTrajectoryLoader.ts)
- real offline experiment entry point:
  [scripts/run-paper-offline-experiments.ts](./scripts/run-paper-offline-experiments.ts)
- paper-style aggregation:
  [src/benchmark/ObservedBenchmarkExperiments.ts](./src/benchmark/ObservedBenchmarkExperiments.ts)

## 3. Execution Steps

### Step 1. Run the tests

```bash
npm test
```

### Step 2. Resume the download of SWE trajectories

```bash
source .bench_env/bin/activate
cd ~/Desktop/swe-bench-experiments
python analysis/download_logs.py evaluation/verified/20240620_sweagent_claude3.5sonnet --only_trajs --skip_existing
```

### Step 3. Run the real offline evaluation of the three benchmarks

```bash
PROC_BENCH_DISABLE_TREE_SITTER=1 npx ts-node scripts/run-paper-offline-experiments.ts \
  --android-root external_data/android_bench \
  --terminal-root external_data/terminal_bench \
  --swe-root ~/Desktop/swe-bench-experiments/evaluation/verified/20240620_sweagent_claude3.5sonnet/trajs \
  --output output/paper-offline-experiments \
  --resume true \
  --quiet true
```

If you need to retain the complete JSON report for each trajectory:

```bash
PROC_BENCH_DISABLE_TREE_SITTER=1 npx ts-node scripts/run-paper-offline-experiments.ts \
  --android-root external_data/android_bench \
  --terminal-root external_data/terminal_bench \
  --swe-root ~/Desktop/swe-bench-experiments/evaluation/verified/20240620_sweagent_claude3.5sonnet/trajs \
  --output output/paper-offline-experiments \
  --resume true \
  --quiet true \
  --save-reports true
```

## 4. Artifacts

The script generates:

- `trajectory-records.jsonl`
- `trajectory-records.csv`
- `observed-benchmark-summary.csv`
- `observed-benchmark-summary.md`
- `defect-failure-correlation-overall.csv`
- `defect-failure-correlation-by-benchmark.csv`
- `swe-control-preservation.csv`
- `reproduction-status.md`
- `trajectory-failures.jsonl` (if there are any failures)

Notes:

- `PROC_BENCH_DISABLE_TREE_SITTER=1` disables native tree-sitter parsing, forcing AST extraction to degrade to the regex fallback.
- This is done to ensure the stability of large-scale batch evaluation over public trajectories; it does not affect execution of the main pipeline covering standardized events, the 11 detectors, risk, and control preservation.

## 5. Actual Correspondence with the Paper's Experiments

### Can be genuinely completed

- offline evaluation of the real public trajectories of the three benchmarks
- trigger statistics for the 11 defect benchmarks
- structured summaries of process-level risk, control preservation, and execution guidance
- real control preservation statistics on SWE
- offline correlation analysis between defect triggers and task failure

### Currently cannot be strictly completed

- the detector-vs-human precision / recall / F1 / AP / AUROC of RQ1 Table 1
  Reason: the 200-trajectory human annotation set described in the paper is not present in the current workspace, and no verifiable public annotation file exists.
- the strict calibration experiment of RQ2 Table 2 / Figure 3
  Reason: real defect labels on the same annotation set are missing.
- the three-configuration rerun comparison of `Baseline / Detector-Only / W+E-Guidance` in RQ3 Table 3 / Table 4
  Reason: only public observed trajectories are currently available; these are not matched reruns of the same task under the three governance configurations.
- the strict baseline vs guidance comparison of RQ4 Table 5 / Figure 4
  Reason: only observed public runs are currently available; there are no W+E-guidance rerun trajectories.

## 6. Authenticity Constraints

- `observed-public-run` denotes only "the offline ProcBench evaluation result over real public trajectories", and is **not equivalent to** the `Baseline` in the paper.
- If human annotations or matched reruns are missing, the output must retain the `blocked` / `partial` status and must not be substituted with provisional numbers taken from the paper.
- fragile-success in `swe-control-preservation.csv` uses the operationalized approximation defined in the paper:
  among successful trajectories, `CP < the current sample mean` and either `Long Chain` or `Dead Step` was triggered.
