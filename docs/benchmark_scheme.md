# Benchmark Evaluation Scheme

This scheme corresponds to the current implementation: non-scored, reproducible, and issue-centric.

## 1. Basic Principles

- Evaluation depends solely on replayable trajectories and project analysis results.
- It does not depend on subjective human scoring.
- The output of each benchmark is an issue, not a score.
- `taskOutcome` reports a quality summary and does not contribute to any externally facing total score.

## 2. Data Sources

- JSONL trajectories
  - `messages`
  - `toolUses`
  - `toolResults`
  - `replacements`
  - token usage
- AST
  - [src/analyzers/AstAnalyzer.ts](./src/analyzers/AstAnalyzer.ts)
- Project relationships
  - [output/project-ast.json](./output/project-ast.json)
- External related-files data
  - [output/file-graph.json](./output/file-graph.json)

## 3. The issue Model

Every issue contains:

- metric name
- severity
- location
- evidence
- suggestion

Severity is divided into:

- `warning`
- `error`

Severity weights may be retained internally for ranking purposes, but total scores, grades, and dimension scores are no longer reported.

## 4. The 11 Benchmarks

- Ghost Context
- Oversized Rules
- Context Thrashing
- Tool Call Chain
- Dead Step
- Duplicate Step
- Wrapper Workflow
- Context Coupling
- Long Chain
- Interface Inconsistency
- Weak Tool

For detailed definitions, see:

- [docs/benchmark_specs.md](./docs/benchmark_specs.md)
- [docs/benchmark_evaluation_guide.md](./docs/benchmark_evaluation_guide.md)

## 5. `taskOutcome`

[src/evaluators/TaskOutcomeEvaluator.ts](./src/evaluators/TaskOutcomeEvaluator.ts) reports:

- `taskCompletionRate`
- `outputExecutability`
- `postModificationVerificationRate`

These are quality-descriptive metrics and are not converted into an externally facing total score.

## 6. Statistical Aggregation

[src/benchmark/BenchmarkRunner.ts](./src/benchmark/BenchmarkRunner.ts) currently performs:

- average number of warnings per dimension
- average number of errors per dimension
- Bootstrap 95% CI
- an illustrative Cohen's d over the first two reports

Accordingly, "statistical significance" in the current setting is framed around issue counts rather than around scores.

## 7. Notes on Differences in the Current Implementation

Compared with the older scored-evaluation documentation, the current implementation has removed:

- `totalScore`
- `overallAssessment`
- the per-dimension `score`
- the externally facing semantics of weights and deduction caps

Retained, but used only for internal ranking:

- `deduction`

## 8. Reproduction Recommendations

- Run the project analysis first, then evaluate the session.
- Prepare positive and negative examples for the key detectors.
- Verify that `Write` does not hit `deadStep`.
- Verify that the benchmark summary reports warning/error statistics rather than average scores.
