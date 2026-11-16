# Reproducing the ProcCtrlBench Paper Artifacts

This document maps every table and figure in the paper to the code that produces it, and states
exactly what input each one needs. It reflects the **paper v8 numbering**.

## Scope and honesty boundary

This repository contains the **implementation** and the reproduction scripts. It does not ship:

- the 200-case process-level annotation set, or
- the 11 agent-model configurations' matched trajectory corpus (200 runs, 50 tasks, 80 held-out).

`output/` and `external_data/` are git-ignored. A fresh clone has code but no data. Every artifact
that depends on missing input is reported as **blocked** with the specific input it needs. Nothing in
the pipeline substitutes placeholder or synthesised values for annotation-dependent or
human-experiment-dependent numbers.

Consequently: running this pipeline on your own data yields a valid instantiation of the benchmark.
It does not by itself reproduce the specific numeric values printed in the paper.

## New in this revision (P0 / P1 infrastructure)

| Area | Script / module | Purpose |
|---|---|---|
| Annotation template | `scripts/create-annotation-template.ts` | Emits an empty 11-defect template + long-format worklist from evaluated records |
| 80/40/80 split | `scripts/export-annotation-split.ts` | Exact 80/40/80 stratified task-level split |
| Hierarchical calibration | `scripts/fit-hierarchical-calibration.ts`, `src/benchmark/HierarchicalCalibration.ts` | Fit `alpha_j`, `beta_j`, `gamma_c,d` on calibration split |
| Paper CP | `src/benchmark/PaperControlPreservation.ts` | Appendix A.5 five-subdimension CP |
| Corpus sampling | `scripts/sample-paper-corpus.ts`, `config/paper-systems.json` | Select the 11-system / 50-task / 200-run composition; emits gap report |
| Held-out artifacts | `buildTable13`, `buildTable14` | Table 13/14 on the evaluation split |
| Paired tests | `scripts/paired-system-tests.ts` | Task-grouped paired bootstrap + Wilcoxon |
| Detector spec | `scripts/export-detector-specs.ts`, `config/paper-detector-specs.json` | Table 3 |
| Ablations | `scripts/run-ablation-study.ts` | Table 9 |
| Intervention analysis | `scripts/analyze-intervention-validation.ts` | Table 11 |
| Policy / infra | `scripts/analyze-common-environment.ts` | Table 15 |

## End-to-end pipeline

### Step 0 — evaluate trajectories with paper scoring

```bash
PROC_BENCH_DISABLE_TREE_SITTER=1 npx ts-node scripts/run-paper-offline-experiments.ts \
  --android-root  /path/to/android-bench/out \
  --terminal-root /path/to/terminal-bench/runs \
  --swe-root      /path/to/swe-trajectories \
  --output output/runs/claude-code-sonnet-4.6 \
  --variant "Claude Code / Sonnet 4.6" \
  --resume true --quiet true --save-reports true
```

Add `--calibration-profile output/calibration/hierarchical.json` once Step 3 has produced a profile.
Each run writes `trajectory-records.jsonl` with:

- `pb` computed with `eta = 0.70`;
- `controlPreservationSource = paper-appendix-a5`;
- `controlPreservationRaw` (CPraw);
- `defectSignals` (continuous evidence scores);
- `defectRisks` and `errorBandDefectCount`.

### Step 1 — build the paper corpus and split

```bash
npx ts-node scripts/sample-paper-corpus.ts \
  --records output/runs/*/trajectory-records.jsonl \
  --config config/paper-systems.json \
  --output output/paper-corpus

npx ts-node scripts/create-annotation-template.ts \
  --records output/paper-corpus/paper-corpus-selection.jsonl \
  --output output/annotations/template.json

# after two annotators fill the worklist:
npx ts-node scripts/export-annotation-split.ts \
  --annotations output/annotations/annotations.json \
  --output output/annotations/split.json \
  --seed 20270101
```

`sample-paper-corpus.ts` never fabricates trajectories. If systems or matched tasks are missing, the
manifest is `status: partial` and `paper-corpus-gaps.md` lists every gap.

### Step 2 — fit hierarchical Bayesian calibration

```bash
npx ts-node scripts/fit-hierarchical-calibration.ts \
  --records output/paper-corpus/paper-corpus-selection.jsonl \
  --annotations output/annotations/annotations.json \
  --split output/annotations/split.json \
  --output output/calibration/hierarchical.json
```

`z(s)` uses development-split means/stds; `alpha_j`, `beta_j`, `gamma_c,d` are fitted on the
calibration split; `beta_j >= 0`; exempt risks are floored at 0.001.

### Step 3 — build the paper tables and figures

```bash
npx ts-node scripts/generate-paper-artifacts.ts \
  --records output/paper-corpus/paper-corpus-selection.jsonl \
  --annotations output/annotations/annotations.json \
  --split output/annotations/split.json \
  --output output/paper-artifacts \
  --eta 0.70 \
  --replicates 10000
```

### Step 4 — P1 analyses

```bash
npx ts-node scripts/export-detector-specs.ts --output output/paper-artifacts
npx ts-node scripts/run-ablation-study.ts --records ... --split ... --labels ... --output output/paper-artifacts
npx ts-node scripts/analyze-intervention-validation.ts --input ... --output output/paper-artifacts
npx ts-node scripts/analyze-common-environment.ts --records ... --split ... --output output/paper-artifacts
npx ts-node scripts/paired-system-tests.ts --records ... --split ... --output output/paper-artifacts
```

## Artifact map (paper v8 numbering)

| Paper artifact | Output file | Built by | Requires |
|---|---|---|---|
| Table 1 (left) | `table1-defect-instantiation.csv` | `buildTable1` | annotations |
| Table 1 (right) | `table1-calibration-ece.csv` | `buildTable1` | annotations + calibrated risks |
| Table 2 | `table2-cross-system-scorecard.csv` | `buildTable2` | trajectories (11 systems) |
| Table 3 | `table3-detector-specs.csv/.md` | `export-detector-specs.ts` | `config/paper-detector-specs.json` |
| Table 4 | `table4-evaluation-point-accounting.csv` | `buildTable4Accounting` | annotations |
| Table 5 | `table5-sample-distribution.csv` | `buildTable5Distribution` | annotations + split |
| Table 6 | `table6-outcome-vs-procctrl.csv` | `buildTable4` (alias `buildTable6Outcome`) | endpoint outcomes |
| Table 7 | `table7-annotation-agreement.csv` | `buildTable5` (alias `buildTable7Agreement`) | dual annotations |
| Table 8 | `table8-scenario-scores.csv` | `buildTable3` (alias `buildTable8`) | trajectories |
| Table 9 | `table9-baselines-ablations.csv` | `run-ablation-study.ts` | held-out records + intervention/breakdown labels |
| Table 10 | `table10-bootstrap-rank-stability.csv` | `buildTable6` (alias `buildTable10Bootstrap`) | >= 2 systems |
| Table 11 | `table11-intervention-validation.csv` | `analyze-intervention-validation.ts` | 44 intervention runs |
| Table 12 | `table12-control-subdimensions.csv` | `buildTable7` (alias `buildTable12Control`) | trajectories |
| Table 13 | `table13-heldout-detection-calibration.csv` | `buildTable13` | annotations + split + dev split |
| Table 14 | `table14-heldout-cross-system.csv` | `buildTable14` | split |
| Table 15 | `table15-policy-infra.csv` | `buildTable15` / `analyze-common-environment.ts` | trajectories + common-env runs |
| Figure 2 (left) | `fig2a-defect-failure-correlation.csv` | `buildFig2a` | endpoint outcomes |
| Figure 2 (right) | derive from Table 2 | `buildTable2` | trajectories |
| Figure 3 | `fig3-inter-defect-correlation.csv` | `buildFig6` (alias `buildFig3Correlation`) | >= 2 trajectories |
| Figure 4 | `fig4-per-defect-profiles.csv` | `buildFig3` (alias `buildFig4Profiles`) | trajectories |
| Figure 5 | `fig5-bootstrap-ci.csv` | `buildFig5` | trajectories |
| Figure 6 | derive from Table 6 rank shift | `buildTable4` | endpoint outcomes |
| Figure 7 | `fig7-reliability-diagram.csv` | `buildTable1` | annotations |
| Figure 8 | `fig8-eta-sensitivity.csv` | `buildFig8` | trajectories |
| Paired tests | `paired-system-tests.csv/.md` | `paired-system-tests.ts` | held-out split |

## Scoring definitions as implemented (paper v8)

- **`p_j`** — max posterior risk among findings for that defect; `0` if no finding.
- **`Q_d = 1 - mean_j(p_j)`**; **`Qdef = 0.25 * sum_d Q_d`**.
- **`CP`** — Appendix A.5: five subdimensions with **equal weights 0.20**; penalties
  `0.5 p_GC`, `0.4 p_LC`, `0.3 max(p_CC, p_TCC)`; `lambda1 = 0.05 s^-1`; recovery window 3 steps.
  `controlPreservationRaw` is the CPraw ablation (no `p_j` terms).
- **`PB = eta * Qdef + (1 - eta) * CP`**, **eta = 0.70**.
- **Fragile success** — endpoint success with `PB < 0.65` **or** at least **2** defects with
  `p_j >= 0.70`.
- **Severity bands** — `delta_e = 0.70`; `delta_w = 0.55` (paper does not fix a unique warning
  boundary). Bands are reporting aids, not the score.
- **Calibration** — `logit(p) = alpha_j + beta_j * z(s_j) + gamma_c,d`; `z` from the development
  split; parameters from the calibration split; exempt -> 0.001.
- **ECE** — 10 equal-mass quantile bins. Hard-threshold probabilities use development-split
  empirical `p_pos` / `p_neg` when a dev split is supplied; otherwise 0/1.
- **Bootstrap** — 10,000 replicates by default. Table 10 resamples at the task level and uses
  paired resampling when all systems share the same task keys; otherwise it falls back to
  per-system stratified resampling. Paired system comparisons use task-grouped paired bootstrap +
  Wilcoxon (`paired-system-tests.ts`).

## Data requirements

| Input | Paper scale | Used by |
|---|---|---|
| Annotation set | 200 cases x 11 defects = 2,200 judgments | Tables 1, 4, 5, 7, 13; Figure 7; calibration |
| Matched corpus | 11 systems, 200 runs, 50 tasks, 80 held-out | Tables 2, 6, 8, 10, 12, 14, 15; Figures 2/4/5/8 |
| Development split | 80 cases | z-normalization, threshold tuning |
| Calibration split | 40 cases | hierarchical Bayes |
| Evaluation split | 80 cases | Tables 13/14, paired tests |
| Intervention runs | 44 runs | Table 11 |
| Common-environment runs | 4 models in one OpenCode harness | Table 15 |
| Ablation labels | intervention/breakdown | Table 9 |

## Reproducibility notes

- Bootstrap uses a seeded `mulberry32` generator; Table 10 and Figure 5 are bit-reproducible for a
  given `--seed`.
- The artifact script rejects pre-scorecard `trajectory-records.jsonl` files rather than treating
  missing `pb` as zero.
- `sample-paper-corpus.ts` reports `partial` rather than filling missing runs.
- The detector table is marked `approximate` where the repository detector does not implement the
  literal paper formula; this is stated in `table3-detector-specs.md`.

## Verification

`npm test` builds the project and runs the unit suite, including:

- `paper-scorecard-alignment.test.js` — eta / fragile / Qpolicy / Qinfra alignment.
- `hierarchical-calibration.test.js` — monotone beta, exempt floor, profile validation.
- `paper-metrics.test.js` — AUROC/AP/AUROC closed forms, kappa, seeded bootstrap.
- `annotation-set.test.js` — three-valued judgment semantics, adjudication, exact 80/40/80.
- `paper-artifacts.test.js` — blocked vs generated artifacts, Table 12 column names, artifact count.