# Evaluation Scheme for the 11 Evaluation Benchmarks

This document describes the currently executable scheme: standardized event representation + AST / file graph enhancement + detector findings + risk posteriors + control preservation + non-scored statistical aggregation.

## Overall Description

- Data sources:
  - JSONL trajectories
  - project AST
  - external related-files data
- Output forms:
  - issue
  - finding
  - posterior risk
  - control preservation
  - execution guidance
  - warning / error statistics
  - task outcome quality summary
- Statistical forms:
  - mean
  - 95% CI
  - illustrative effect size

## Common Capabilities

- AST:
  - [src/analyzers/AstAnalyzer.ts](./src/analyzers/AstAnalyzer.ts)
- Project relationships:
  - [src/analyzers/ProjectAstLoader.ts](./src/analyzers/ProjectAstLoader.ts)
- External related files:
  - [src/analyzers/FileAssociationLoader.ts](./src/analyzers/FileAssociationLoader.ts)
- Code context footprint:
  - [src/analyzers/CodeContextAnalyzer.ts](./src/analyzers/CodeContextAnalyzer.ts)

## Per-Benchmark Scheme

### Ghost Context

- Examine whether a summary and its source text coexist over a long span.
- Examine whether a large payload is unconsumable.
- Examine whether the original content has lost its value as downstream code context.

### Oversized Rules

- Examine the size of the `system` message.
- Examine its share of the cumulative context.
- Examine whether it is the largest static block.

### Context Thrashing

- Examine whether compaction occurs shortly after loading.
- Examine whether the code context loaded before compaction is reused downstream.

### Tool Call Chain

- Examine consecutive chains of the same-named tool.
- Examine cyclic patterns of length 2 to 4.
- Examine whether the batch-processing / search-convergence exemptions are satisfied.

### Dead Step

- Examine whether the result is referenced by a subsequent tool input.
- Examine whether the result is referenced by assistant text.
- Examine whether it reaches relevant files, relevant symbols, or relevant neighborhoods.
- Examine whether it leads to a branch change.
- `Write` is never judged to be a dead step.

### Duplicate Step

- Examine the structural similarity of the inputs.
- Examine whether relevant files changed in between.
- Examine the textual similarity of the outputs.
- Examine whether the AST symbol sets overlap heavily.

### Wrapper Workflow

- Examine whether the agent merely passes data through.
- Examine whether internal steps are extremely few.
- Examine whether verification, transformation, and aggregation logic are absent.

### Context Coupling

- Examine SCCs in the call graph.
- Examine alternating patterns.
- Examine back edges.
- Examine whether backflow forms between code neighborhoods.

### Long Chain

- Examine the total chain length.
- Examine explicit subtasks.
- Examine explicit checkpoints.
- Examine implicit code-cluster switching.
- Examine implicit verification re-reads.

### Interface Inconsistency

- Examine schema divergence.
- Examine divergence in result shape.
- Examine divergence in symbol type distribution.
- Examine interface risk within the same code neighborhood.

### Weak Tool

- Examine the number of applicable tasks against the number of actual calls.
- Examine whether alternative tools crowd out the calls.
- Examine the identification of applicable-scenario opportunities after project AST enhancement.

## Current Reporting Conventions

### Single report

- `warnings` per dimension
- `errors` per dimension
- `taskOutcome.details`
- `diagnostics`
- `findings`
- `risk`
- `controlPreservation`
- `executionGuidance`
- `summary`

### Multiple reports

- average number of warnings
- average number of errors
- `overallRisk`
- `averagePosteriorRisk`
- `controlPreservation.score`
- `executionGuidance.autonomyLevel`
- `taskCompletionRate`
- `outputExecutability`
- `postModificationVerificationRate`
- 95% CI

## Conventions No Longer in Use

The following conventions belong to earlier versions of the documentation and no longer represent the current implementation:

- total score
- rating
- weighted aggregation by weights
- dimension scores

## Method Pipeline

The current implementation organizes the evaluation logic along the following pipeline:

`execution trajectory -> standardized issue / finding -> detectorScore -> posteriorRisk -> warning/error risk semantics -> controlPreservation -> executionGuidance`

Notes:

- `issue` remains the direct output of a detector, preserving the original compatibility convention.
- `finding` is the standardized process-level signal, explicitly recording `metric`, `dimension`, `detectorScore`, `posteriorRisk`, and `riskSeverity`.
- `posteriorRisk` currently adopts `heuristic-bayesian-proxy`, producing a lightweight posterior estimate from empirical priors, severity anchors, evidence strength, and the detector score.
- `controlPreservation` is a supplementary dimension independent of defect counts; it measures interpretability, interruptibility, corrigibility, reversibility, and the handing back of decision authority during execution.
- `executionGuidance` serves to feed the risk layer back into the execution layer, accommodating downstream runtime guard / sidecar governance.

## Recommended Companion Reading

- [docs/benchmark_specs.md](./docs/benchmark_specs.md)
- [docs/current_benchmark_schemes.md](./docs/current_benchmark_schemes.md)
- [docs/metrics.md](./docs/metrics.md)
