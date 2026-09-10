# Evaluation Metric Implementation Overview

This document describes the metric system as realized by the current code implementation. The current system performs non-scored evaluation, and focuses on:

- producing issues
- producing findings
- reporting posterior risk
- reporting control preservation
- reporting execution guidance
- counting warnings / errors
- reporting a quality summary of the task outcome
- supporting statistical aggregation across reports

## Implementation Locations

- Threshold configuration:
  - [src/config/evaluation.config.ts](./src/config/evaluation.config.ts)
- Type definitions:
  - [src/types/evaluation.types.ts](./src/types/evaluation.types.ts)
- Detectors:
  - [src/detectors](./src/detectors)
- Evaluators:
  - [src/evaluators](./src/evaluators)
- AST / file relationship analysis:
  - [src/analyzers](./src/analyzers)
- Report assembly and output:
  - [src/scoring/ScoreCalculator.ts](./src/scoring/ScoreCalculator.ts)
  - [src/scoring/ReportGenerator.ts](./src/scoring/ReportGenerator.ts)

## Report Model

### `taskOutcome`

`taskOutcome` is no longer aggregated into a total score; it only reports three quality metrics:

- `taskCompletionRate`
- `outputExecutability`
- `postModificationVerificationRate`

### The 4 issue dimensions

- context management
- tool usage efficiency
- workflow architecture
- tool ecosystem consistency

Each dimension reports:

- `warnings`
- `errors`
- `details`
- `issues`

### `diagnostics`

Exposed externally:

- `metric`
- `severity`
- `message`
- `location`
- `suggestion`
- `evidence`

Internally, detectors may still use `deduction` as a severity weight, but it no longer enters the externally facing schema of the final report.

### `findings`

`findings` is the standardized process-level projection of `diagnostics`, additionally providing:

- `dimension`
- `detectorScore`
- `posteriorRisk`
- `riskSeverity`
- `evidenceStrength`
- `exemptionsApplied`
- `conditionSignals`

### `risk`

`risk` is the process-level risk aggregation layer; the current implementation reports:

- `overallRisk`
- `averagePosteriorRisk`
- `warningFindings`
- `errorFindings`
- `topRiskFindings`
- `averagePosteriorRisk` / `maxPosteriorRisk` for each top-level dimension

### `controlPreservation`

`controlPreservation` measures control preservation capability, and comprises:

- `interpretability`
- `interruptibility`
- `corrigibility`
- `reversibility`
- `handoffAwareness`
- the total `score`
- the `level` grade

### `executionGuidance`

`executionGuidance` feeds process-level risk back as recommended governance actions; it currently reports:

- `autonomyLevel`
- `recommendedActions`
- `rationale`

## The 11 Benchmarks

### 1. Ghost Context

- Implementation:
  - [src/detectors/GhostContextDetector.ts](./src/detectors/GhostContextDetector.ts)
  - [src/analyzers/ContextChainAnalyzer.ts](./src/analyzers/ContextChainAnalyzer.ts)
- Checks:
  - a summary coexisting with its source text
  - large payloads that cannot be consumed
  - a summary exists, but the original result is never referenced again afterwards
- Enhancements:
  - combined with `CodeContextAnalyzer`
  - combined with `project-ast.json` to determine whether the code context is still active

### 2. Oversized Rules

- Implementation:
  - [src/detectors/OversizedRulesDetector.ts](./src/detectors/OversizedRulesDetector.ts)
- Checks:
  - the size of the `system` message
  - its share of the context
  - whether it is the largest static content block

### 3. Context Thrashing

- Implementation:
  - [src/detectors/ThrashingDetector.ts](./src/detectors/ThrashingDetector.ts)
  - [src/analyzers/ContextChainAnalyzer.ts](./src/analyzers/ContextChainAnalyzer.ts)
- Checks:
  - loading a large object while close to the window limit
  - compaction occurring within 2 steps after loading
  - the code context not being effectively reused before compaction
- Note:
  - Window occupancy statistics are currently computed along the true ancestor chain, so tokens from unrelated sibling branches are no longer mixed into the current step.

### 4. Tool Call Chain

- Implementation:
  - [src/detectors/ToolChainDetector.ts](./src/detectors/ToolChainDetector.ts)
- Checks:
  - excessively long consecutive calls to the same tool
  - tool calls forming a cyclic pattern
- Exemptions:
  - significantly different inputs
  - legitimate batch processing
  - convergent search

### 5. Dead Step

- Implementation:
  - [src/detectors/DeadStepDetector.ts](./src/detectors/DeadStepDetector.ts)
  - [src/analyzers/ContextChainAnalyzer.ts](./src/analyzers/ContextChainAnalyzer.ts)
- Checks:
  - whether the tool result feeds into a subsequent tool input
  - whether it feeds into an assistant textual plan
  - whether it reaches a relevant file or relevant symbol
  - whether it induces a branch change
- Current special rule:
  - `Write` is never judged to be a `deadStep`
- Note:
  - "Subsequent reference" is currently restricted, as a priority, to the scope of true descendant messages, so as to avoid late-arriving messages from unrelated branches being misjudged as consumption.

### 6. Duplicate Step

- Implementation:
  - [src/detectors/DuplicateStepDetector.ts](./src/detectors/DuplicateStepDetector.ts)
- Checks:
  - structurally similar inputs
  - no relevant file changes in between
  - highly similar outputs
  - highly overlapping AST symbol sets

### 7. Wrapper Workflow

- Implementation:
  - [src/detectors/WrapperDetector.ts](./src/detectors/WrapperDetector.ts)
- Checks:
  - very few internal steps in the agent
  - a single downstream tool type
  - similar input and output
  - no verification
  - very low symbol increment

### 8. Context Coupling

- Implementation:
  - [src/detectors/CouplingDetector.ts](./src/detectors/CouplingDetector.ts)
- Checks:
  - SCCs in the call graph
  - alternating call patterns
  - back edges
  - repeated backflow between code neighborhoods

### 9. Long Chain

- Implementation:
  - [src/detectors/LongChainDetector.ts](./src/detectors/LongChainDetector.ts)
- Checks:
  - explicit subtasks
  - explicit checkpoints
  - implicit code-cluster switching
  - implicit verification re-reads

### 10. Interface Inconsistency

- Implementation:
  - [src/detectors/InterfaceConsistencyDetector.ts](./src/detectors/InterfaceConsistencyDetector.ts)
- Checks:
  - divergence in parameter name sets
  - divergence in parameter types
  - divergence in the shape of returned results
  - divergence in the type distribution of returned symbols
  - interface risk over adjacent code neighborhoods

### 11. Weak Tool

- Implementation:
  - [src/detectors/WeakToolDetector.ts](./src/detectors/WeakToolDetector.ts)
- Checks:
  - the number of applicable tasks
  - the number of actual calls
  - coverage by alternative tools
  - identification of applicable scenarios after enhancement with the project AST / file relationships

## AST and Project Relationships

### AST

- [src/analyzers/AstAnalyzer.ts](./src/analyzers/AstAnalyzer.ts)
- based on tree-sitter
- multi-language support
- extracts:
  - classes
  - functions
  - methods
  - properties
  - variables
  - calls

### Project-level relationships

- [src/analyzers/ProjectAstLoader.ts](./src/analyzers/ProjectAstLoader.ts)
- [src/analyzers/FileAssociationLoader.ts](./src/analyzers/FileAssociationLoader.ts)

Input sources:

- project code parsing results
- external related-files data

Output uses:

- indirect file references
- symbol ownership
- code neighborhood expansion
- module cluster switching identification

## Current Statistical Conventions

### A single report

A single report reports:

- total number of warnings
- total number of errors
- number of warnings / errors per dimension
- key issues
- strengths

### Multiple reports

[src/benchmark/BenchmarkRunner.ts](./src/benchmark/BenchmarkRunner.ts) currently aggregates:

- average number of warnings per dimension
- average number of errors per dimension
- 95% CI

No longer aggregated:

- total score
- rating
- dimension scores
