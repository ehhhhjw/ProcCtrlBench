# Paper v8 Reproduction Checklist (P0 / P1)

This checklist separates **implemented code** from **data that must come from the authors or from
real controlled runs**. It is intentionally explicit about what cannot be synthesised.

## P0 — required for the main results

### P0.1 Scoring definitions

- [x] `eta = 0.70` in `PB = eta * Qdef + (1 - eta) * CP`
- [x] Fragile success: `PB < 0.65` **or** at least 2 defects with `p_j >= 0.70`
- [x] `delta_e = 0.70`; warning boundary `delta_w = 0.55`
- [x] CP equal weights 0.20 + Appendix A.5 penalties (`0.5 p_GC`, `0.4 p_LC`, `0.3 max(p_CC, p_TCC)`)
- [x] CPraw ablation (`controlPreservationRaw`)
- [x] Paper-aligned artifact IDs and `paperRef` values

### P0.2 Annotation set

- [x] Annotation schema + validator (`procctrlbench-annotation-v1`)
- [x] Template + long-format worklist generator
- [x] Exact 80/40/80 stratified task-level split
- [ ] **200 real cases x 11 defects = 2,200 human judgments** (two annotators + adjudication)
- [ ] Evidence notes / exemption rationales for every judgment

The last two items are human data. This repository does not fabricate them.

### P0.3 11-system matched corpus

- [x] Machine-readable composition (`config/paper-systems.json`)
- [x] Sampler with task-level matching and gap report
- [x] Corpus manifest + split JSON
- [ ] **Real runs for 11 agent-model configurations**
- [ ] **50 matched tasks (25 SWE / 15 Terminal / 10 Android)**
- [ ] **200 runs (80 held-out by the paper's table; the row cells sum to 78)**
- [ ] Matched token / wall-clock budgets within each agent family

### P0.4 Calibration

- [x] Development-split z-normalization
- [x] Calibration-split MAP fit of `alpha_j`, `beta_j`, `gamma_c,d`
- [x] `beta_j >= 0`; exempt -> 0.001
- [x] Profile loader wired into `run-paper-offline-experiments.ts`
- [ ] Real 80/40/80 annotations to fit the profile

### P0.5 Held-out outputs

- [x] Split-aware filtering
- [x] Table 13 (detection / calibration / Brier / Log-Loss)
- [x] Table 14 (cross-system on held-out)
- [x] Task-grouped paired bootstrap + Wilcoxon (`paired-system-tests.ts`)
- [ ] Real held-out corpus and annotations

## P1 — appendix experiments

- [x] Table 3 detector specification exporter (`approximate` fidelity is recorded)
- [x] Table 4 evaluation-point accounting
- [x] Table 5 per-system / per-source distribution
- [x] Table 9 baseline/ablation runner; unavailable ablations are blocked, not fabricated
- [x] Table 11 intervention analysis + input template
- [x] Table 15 Qpolicy/Qinfra + common-environment analysis
- [ ] Held-out intervention/breakdown labels (Table 9)
- [ ] 44 real intervention runs (Table 11)
- [ ] 4-model common OpenCode environment runs (Table 15)

## Commands

```bash
# 0. verify code
npm test

# 1. select the paper corpus and report gaps
npm run paper:corpus -- \
  --records output/runs/<system>/trajectory-records.jsonl \
  --output output/paper-corpus

# 2. generate the annotation template + worklist
npm run paper:annotation-template -- \
  --records output/paper-corpus/paper-corpus-selection.jsonl \
  --output output/annotations/template.json

# 3. export the exact 80/40/80 split
npm run paper:split -- \
  --annotations output/annotations/annotations.json \
  --output output/annotations/split.json

# 4. fit hierarchical calibration
npm run paper:calibrate -- \
  --records output/paper-corpus/paper-corpus-selection.jsonl \
  --annotations output/annotations/annotations.json \
  --split output/annotations/split.json \
  --output output/calibration/hierarchical.json

# 5. evaluate with calibration
npm run paper:evaluate -- \
  --records-input output/paper-corpus/paper-corpus-selection.jsonl \
  --output output/runs/final \
  --variant "Claude Code / Sonnet 4.6" \
  --calibration-profile output/calibration/hierarchical.json

# 6. build all tables/figures
npm run paper:artifacts -- \
  --records output/runs/final/trajectory-records.jsonl \
  --annotations output/annotations/annotations.json \
  --split output/annotations/split.json \
  --eta 0.70 --replicates 10000 \
  --output output/paper-artifacts

# 7. P1 analyses
npm run paper:detector-specs -- --output output/paper-artifacts
npm run paper:paired-tests -- --records <records> --split output/annotations/split.json --output output/paper-artifacts
npm run paper:policy-infra -- --records <records> --split output/annotations/split.json --output output/paper-artifacts
npm run paper:ablation -- --records <records> --split output/annotations/split.json --labels <labels.json> --output output/paper-artifacts
npm run paper:intervention -- --input <intervention.json> --output output/paper-artifacts
```

## Acceptance criteria

1. `paper-corpus-manifest.json` is `status: complete` with 11 systems and 200 runs.
2. `artifact-manifest.md` reports Tables 1, 2, 4, 5, 6, 7, 8, 10, 12, 13, 14, 15 and Figures
   2a/3/4/5/7/8 as generated.
3. Tables 9/11/15 have real labels/runs; they are **not** filled with placeholders.
4. `npm test` passes (103 tests).