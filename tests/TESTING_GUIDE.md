# Testing Guide

Current testing and validation should center on the non-scoring output.

## Core Checks

### Report Structure

- `totalScore` must not be present
- `overallAssessment` must not be present
- dimension `score` must not be present
- `summary.totalWarnings` / `summary.totalErrors` must be present
- `diagnostics` must not expose `deduction`

### Task Outcome

- `taskCompletionRate` must be within `0~1`
- `outputExecutability` must be within `0~1`
- `postModificationVerificationRate` must be within `0~1`

### Baseline Rules

- `Write` must not be judged a `deadStep`
- `DuplicateStep` should take AST symbol overlap into account
- `LongChain` should take explicit and implicit phase splits into account
- `InterfaceConsistency` / `WeakTool` should be able to use project AST and related files data

### Aggregation

- `BenchmarkRunner` may only aggregate warning/error statistics
- it must no longer compute average scores or ratings

## Recommended Validation Procedure

1. Run `npm run build`
2. Run `npm run example`
3. Inspect the fields of the generated JSON / Markdown reports
4. Prepare test cases with a project AST and test cases without one, then compare the difference in detector behavior
