# Evaluation Benchmark Scheme Overview

This document consolidates the definitions, signals, thresholds, false positive control, and remediation recommendations of the 11 evaluation benchmarks under the current diagnostic layer. That layer is non-scored: the severity of an issue is used for diagnosis and ranking, and no total score is produced.

Paper v8 Table 3 executable specifications (continuous score formulas, `tau_j`, exemption rules) live in
[config/paper-detector-specs.json](../config/paper-detector-specs.json) and can be exported with
`scripts/export-detector-specs.ts`. The mapping from current detectors to the paper formulas is marked
`approximate`; a strict reproduction requires porting the Table 3 formulas and re-tuning on the 80
development trajectories.

## Common Enhancements

- AST symbol-level analysis:
  - [src/analyzers/AstAnalyzer.ts](./src/analyzers/AstAnalyzer.ts)
- Project analysis entry points:
  - [config/project-analysis.config.json](./config/project-analysis.config.json)
  - [scripts/build-file-graph.ts](./scripts/build-file-graph.ts)
- Project AST:
  - [output/project-ast.json](./output/project-ast.json)
- File graph:
  - [output/file-graph.json](./output/file-graph.json)
- Prewarn:
  - [output/prewarn.json](./output/prewarn.json)

## 1. Ghost Context

- Thresholds:
  - warning `512`
  - error `1024`
- Typical issues:
  - a summary coexisting with its source text for a long time
  - unconsumable payload
  - historical results that have a summary but are no longer referenced afterwards

## 2. Oversized Rules

- Thresholds:
  - token warning `2000`
  - token error `4000`
  - ratio warning `0.20`
  - ratio error `0.35`
- Typical issues:
  - oversized `system` rules
  - `system` rules occupying too large a share
  - `system` rules becoming the largest static block

## 3. Context Thrashing

- Thresholds:
  - `windowThreshold = 0.75`
  - `compressionLookAhead = 2`
- Typical issues:
  - timing fault
  - payload oversize fault

## 4. Tool Call Chain

- Thresholds:
  - repetitive warning `6`
  - repetitive error `10`
  - cyclic warning `3`
  - cyclic error `5`
- Exemptions:
  - diverse inputs
  - legitimate batch processing
  - convergent search

## 5. Dead Step

- Key checks:
  - reference by a subsequent tool input
  - reference by assistant text
  - reference by a file operation
  - branch change
- Current rule:
  - `Write` is not a dead step
- Enhancements:
  - AST symbol references
  - indirect references via project related files

## 6. Duplicate Step

- Key checks:
  - structural similarity of the inputs
  - no relevant file changes in between
  - similarity of the outputs
  - Jaccard overlap of AST symbols
- Exemptions:
  - time-varying commands
  - test-style repeated commands

## 7. Wrapper Workflow

- Statistical starting point:
  - judgment begins only once the same agent has been called at least `5` times
- Typical signals:
  - few internal steps
  - a single downstream tool type
  - highly similar input and output
  - no verification
  - low symbol increment

## 8. Context Coupling

- Typical signals:
  - SCC
  - alternating calls
  - back edges
  - code neighborhood backflow

## 9. Long Chain

- Thresholds:
  - effective warning `12`
  - effective error `20`
  - simple warning `25`
  - simple error `40`
- Enhancements:
  - implicit subtask identification
  - implicit checkpoint identification

## 10. Interface Inconsistency

- Typical signals:
  - parameter name divergence
  - parameter type divergence
  - result shape divergence
  - result symbol type divergence
  - high semantic overlap while the interfaces remain inconsistent

## 11. Weak Tool

- Typical signals:
  - low call rate
  - alternative tools appearing at high frequency
  - still low triggering even after project AST enhancement

## Task Outcome

This is currently a quality summary, not a scored item.

- `taskCompletionRate`
- `outputExecutability`
- `postModificationVerificationRate`

## Aggregation Method

[src/benchmark/BenchmarkRunner.ts](./src/benchmark/BenchmarkRunner.ts) currently reports:

- average number of warnings
- average number of errors
- 95% CI

If a before / after comparison is required, the recommended quantities to compare are:

- the change in the total number of warnings
- the change in the total number of errors
- whether key issues have disappeared
- whether `taskOutcome.details` has improved
