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

## 5. Actual Correspondence with Paper v8 Experiments

### Implemented execution chain

- offline evaluation of real public trajectories from the three benchmarks;
- trigger statistics and continuous evidence scores (`defectSignals`) for the 11 defects;
- Appendix A.5 CP (`controlPreservationSource = paper-appendix-a5`) and CPraw;
- `PB` with eta=0.70 and the paper-aligned fragile-success definition;
- 11-system corpus sampling with a gap report (`scripts/sample-paper-corpus.ts`);
- annotation template and exact 80/40/80 split (`create-annotation-template.ts` / `export-annotation-split.ts`);
- hierarchical Bayesian calibration (`fit-hierarchical-calibration.ts`);
- split-aware Tables 13/14 and Table 4/5, plus Table 3/9/11/15 scripts;
- task-grouped paired bootstrap + Wilcoxon (`paired-system-tests.ts`).

### Still requires author data for strict completion

| Paper artifact | Missing input |
|---|---|
| Table 1 / Table 7 / Table 13 / Figure 7 | 200-case dual annotation + adjudication set |
| Table 2 / Table 6 / Table 8 / Table 10 / Table 12 / Table 14 | 11 systems x 50 matched tasks corpus |
| Table 4 / Table 5 | annotation set + split |
| Table 9 | held-out intervention/breakdown labels |
| Table 11 | 44 active intervention runs |
| Table 15 | 4-model common OpenCode environment runs |

### Boundaries of the current public data

- Android/Terminal/SWE trajectories in `external_data/` are public observational runs, not the paper's 11-system matched matrix;
- old records under `output/paper-*-experiments*` lack `pb/qDef/defectSignals` and must be regenerated with the current code;
- `output/calibration/detector-profile.json` is a demo fit on 1 finding and cannot be used as the paper calibration.

## 6. Authenticity Constraints

- `observed-public-run` denotes only "the offline evaluation result over real public trajectories" and is **not equivalent to** the 11 systems in the paper.
- If human annotations, matched corpora, or intervention data are missing, the output must retain the `blocked` / `partial` status.
- `scripts/sample-paper-corpus.ts` only selects existing trajectories and never fabricates missing runs.
- The paper-aligned fragile-success definition is `PB < 0.65` or at least 2 defects with `p_j >= 0.70`; the old CP-mean-relative definition is retained only as a descriptive statistic.
