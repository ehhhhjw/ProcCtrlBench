# Process-Level Annotation Protocol

ProcCtrlBench evaluates detectors against **process-level** human judgment, not endpoint success.
This document specifies the annotation format the repository expects, so that an annotated set
produced elsewhere can be plugged straight into the artifact pipeline.

This repository ships **no annotation data**. Everything below describes the interface.

## What annotators judge

For each trajectory, annotators judge each of the 11 defect classes independently:

| Judgment | Meaning |
|---|---|
| `present` | The defect genuinely occurs in this trajectory. |
| `absent` | The defect does not occur. |
| `exempt` | The trajectory superficially matches the defect pattern, but the behaviour is appropriate under the task context. |

`exempt` is the load-bearing category. Repeated validation is **not** Duplicate Step when
intervening edits make the reruns appropriate; persistent rule text is **not** Ghost Context when it
serves an ongoing coordination or control role. Annotation is process-oriented: a trajectory is not
labelled defective merely because it failed, nor clean merely because it succeeded.

For detector evaluation, `judgmentToLabel` maps `present` to a positive and both `absent` and
`exempt` to negatives — an exempt pattern is not a defect. Exemption rates are reported separately
in Table 7 and never folded into precision or recall.

## Dual annotation and adjudication

Each trajectory is labelled independently by two annotators. When the two disagree on a defect, a
third reviewer adjudicates and the adjudicated value becomes the final label.

Agreement statistics (Table 7) are computed **before** adjudication, so the raw `annotatorA` and
`annotatorB` values must be preserved in the file rather than overwritten by the adjudicated value.

`validateAnnotationSet` treats a disagreement without an `adjudicated` value as a blocking error;
`flattenAnnotationSet` skips such rows so they cannot silently contaminate metrics.

## File format

A single JSON file:

```json
{
  "schemaVersion": "procctrlbench-annotation-v1",
  "description": "free-text note about annotators and rounds",
  "cases": [
    {
      "caseId": "swe-bench-verified/astropy__astropy-12907/trial-1",
      "benchmark": "swe-bench-verified",
      "taskId": "astropy__astropy-12907",
      "trialId": "trial-1",
      "system": "Claude Code / Sonnet 4.6",
      "success": true,
      "rawPath": "/abs/path/to/trajectory.traj",
      "annotations": {
        "ghostContext": {
          "annotatorA": "present",
          "annotatorB": "absent",
          "adjudicated": "present",
          "evidence": "raw file excerpts from steps 4-9 stay in context after step 11 summarises them"
        },
        "duplicateStep": {
          "annotatorA": "exempt",
          "annotatorB": "exempt",
          "exemptionRationale": "test reruns follow edits, so the repeats are warranted"
        }
      }
    }
  ]
}
```

### Field notes

- `benchmark` is required — the 80/40/80 split stratifies on it. Use `android-bench`,
  `terminal-bench`, or `swe-bench-verified` to match the Table 3 columns.
- `success` is the endpoint outcome, used as the second stratification key and by Table 4.
  Use `null` when the log does not record it.
- `rawPath` is the join key against evaluated trajectories and should be the same path that appears
  in `trajectory-records.jsonl`. Without it the pipeline falls back to `caseId`, and any case that
  matches no trajectory is excluded with a count reported in the manifest.
- `annotations` keys must be the 11 internal defect names below. Unknown keys are a blocking error.
- `evidence` is expected on `present` judgments and `exemptionRationale` on `exempt` judgments.
  Missing either produces a warning, not an error.

## The 11 defect keys

Internal key names, their paper names, and the dimension each belongs to:

| Internal key | Paper name | Abbrev. | Dimension |
|---|---|---|---|
| `ghostContext` | Ghost Context | GC | Context Management |
| `oversizedRules` | Oversized Rules | OR | Context Management |
| `thrashing` | Context Window Thrashing | CWT | Context Management |
| `duplicateStep` | Duplicate Step | DupStep | Tool-Use Efficiency |
| `toolCallChain` | Tool Call Chain | TCC | Tool-Use Efficiency |
| `deadStep` | Dead Step | DeadStep | Tool-Use Efficiency |
| `longChain` | Long Chain | LongChain | Tool-Use Efficiency |
| `wrapperWorkflow` | Wrapper Workflow | WW | Workflow Architecture |
| `contextCoupling` | Context Coupling | CC | Workflow Architecture |
| `inconsistentToolInterface` | Inconsistent Tool Interface | ITI | Tool Ecosystem Consistency |
| `weakTool` | Weak Tool | WT | Tool Ecosystem Consistency |

Note on `longChain`: the paper groups Long Chain under **Tool-Use Efficiency** (four defects), leaving
Workflow Architecture with two. The internal evaluator historically grouped it under
`workflowArchitecture`; `PROCCTRL_TAXONOMY` in `src/benchmark/ProcCtrlScorecard.ts` regroups it to
match the paper, and all paper artifacts use the paper grouping. See the defect definitions in
Appendix A of the paper for the boundary conditions of each class.

## Data splits

`splitAnnotatedCases` partitions the annotated set into development / calibration / evaluation,
defaulting to the paper's 80 / 40 / 80, stratified by `benchmark` and by the `success` bucket.
The split is deterministic given a seed.

The intended discipline is:

- **development** — initialise and refine detector thresholds.
- **calibration** — fit the score-to-posterior-risk mapping.
- **evaluation** — report final metrics, held out from both of the above.

`assertSplitDiscipline` checks that each stage only touched its own split and reports any leakage,
so the separation can be verified rather than assumed.

## Generating a template and the split

```bash
# 1. empty 11-defect template + long-format worklist from evaluated records
npx ts-node scripts/create-annotation-template.ts   --records output/paper-corpus/paper-corpus-selection.jsonl   --output output/annotations/template.json

# 2. after two annotators fill the worklist and adjudication is complete
npx ts-node scripts/export-annotation-split.ts   --annotations output/annotations/annotations.json   --output output/annotations/split.json   --seed 20270101
```

The split script enforces exact 80/40/80 totals, stratifies by `benchmark` and `success`, and
reports any task that crosses splits. The template is explicitly marked `template: true` and
contains no judgments; it is not paper data.

## Validating a set before use

```bash
npx ts-node scripts/generate-paper-artifacts.ts \
  --records output/<run>/trajectory-records.jsonl \
  --annotations path/to/annotations.json \
  --output output/paper-artifacts
```

The script refuses to build annotation-dependent artifacts from a set with blocking issues and
prints the first 20 problems. Warnings (missing evidence notes, partially annotated cases) do not
stop the run but are counted.
