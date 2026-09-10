# Validation Plan

## Goals

Verify that the current implementation is consistent with the documentation, in particular:

- the non-scoring model
- AST enhancement
- related files integration
- `Write` does not count as a `deadStep`

## Code-level Checkpoints

- [src/types/evaluation.types.ts](./src/types/evaluation.types.ts)
- [src/scoring/ScoreCalculator.ts](./src/scoring/ScoreCalculator.ts)
- [src/scoring/ReportGenerator.ts](./src/scoring/ReportGenerator.ts)
- [src/detectors/DeadStepDetector.ts](./src/detectors/DeadStepDetector.ts)
- [src/benchmark/BenchmarkRunner.ts](./src/benchmark/BenchmarkRunner.ts)

## Report-level Checkpoints

- no `totalScore` at the top level
- no `overallAssessment` in `summary`
- no `score` in `dimensions.*`
- `diagnostics` does not expose `deduction`

## Behavior-level Checkpoints

- when a project AST is available, the `DeadStep` / `DuplicateStep` / `LongChain` / `InterfaceConsistency` behaviors make use of project relationships
- when external related files data is available, the file graph should enter the analysis pipeline
- a `Write` operation itself should not be judged a dead step
