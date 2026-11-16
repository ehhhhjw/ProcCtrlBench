# Project Structure

## Top-Level Directories

```text
benchmark_mvp/
├── src/
├── docs/
├── example/
├── tests/
├── output/
├── ClaudeCodeStructure/
├── README.md
├── START_HERE.md
├── QUICKSTART.md
└── USAGE_GUIDE.md
```

## `src/`

```text
src/
├── AgentEvaluator.ts
├── index.ts
├── analyzers/
├── benchmark/
├── config/
├── detectors/
├── evaluators/
├── scoring/
└── types/
```

### Entry Points

- [src/AgentEvaluator.ts](./src/AgentEvaluator.ts)
  - Main evaluation entry point
  - Chains the 5 dimension evaluators together
- [src/index.ts](./src/index.ts)
  - Public exports

### `src/types/`

- [src/types/evaluation.types.ts](./src/types/evaluation.types.ts)
  - `EvaluationConfig`
  - `EvaluationResult`
  - `EvaluationReport`
  - `DetectionIssue`
- [src/types/metrics.types.ts](./src/types/metrics.types.ts)
  - Helper types for each detector

### `src/config/`

- [src/config/evaluation.config.ts](./src/config/evaluation.config.ts)
  - Threshold configuration
  - Context window size
- [config/project-analysis.config.json](./config/project-analysis.config.json)
  - Project path
  - Output directory
  - Path to external related files data

### `src/evaluators/`

- [src/evaluators/BaseEvaluator.ts](./src/evaluators/BaseEvaluator.ts)
  - Shared issue statistics
- [src/evaluators/TaskOutcomeEvaluator.ts](./src/evaluators/TaskOutcomeEvaluator.ts)
  - Task outcome quality summary
- [src/evaluators/ContextManagementEvaluator.ts](./src/evaluators/ContextManagementEvaluator.ts)
- [src/evaluators/ToolUseEfficiencyEvaluator.ts](./src/evaluators/ToolUseEfficiencyEvaluator.ts)
- [src/evaluators/WorkflowArchitectureEvaluator.ts](./src/evaluators/WorkflowArchitectureEvaluator.ts)
- [src/evaluators/ToolEcosystemEvaluator.ts](./src/evaluators/ToolEcosystemEvaluator.ts)

Notes:

- Evaluators no longer produce scores.
- What they produce is `warnings`, `errors`, `issues`, and `details`.

### `src/detectors/`

Detectors corresponding to the 11 benchmarks:

- [src/detectors/GhostContextDetector.ts](./src/detectors/GhostContextDetector.ts)
- [src/detectors/OversizedRulesDetector.ts](./src/detectors/OversizedRulesDetector.ts)
- [src/detectors/ThrashingDetector.ts](./src/detectors/ThrashingDetector.ts)
- [src/detectors/ToolChainDetector.ts](./src/detectors/ToolChainDetector.ts)
- [src/detectors/DeadStepDetector.ts](./src/detectors/DeadStepDetector.ts)
- [src/detectors/DuplicateStepDetector.ts](./src/detectors/DuplicateStepDetector.ts)
- [src/detectors/WrapperDetector.ts](./src/detectors/WrapperDetector.ts)
- [src/detectors/CouplingDetector.ts](./src/detectors/CouplingDetector.ts)
- [src/detectors/LongChainDetector.ts](./src/detectors/LongChainDetector.ts)
- [src/detectors/InterfaceConsistencyDetector.ts](./src/detectors/InterfaceConsistencyDetector.ts)
- [src/detectors/WeakToolDetector.ts](./src/detectors/WeakToolDetector.ts)

### `src/analyzers/`

- [src/analyzers/AstAnalyzer.ts](./src/analyzers/AstAnalyzer.ts)
  - Multi-language AST via tree-sitter
- [src/analyzers/ProjectAstLoader.ts](./src/analyzers/ProjectAstLoader.ts)
  - Loads project AST relationships
- [src/analyzers/FileAssociationLoader.ts](./src/analyzers/FileAssociationLoader.ts)
  - Loads the external related files graph
- [src/analyzers/CodeContextAnalyzer.ts](./src/analyzers/CodeContextAnalyzer.ts)
  - Code context footprint of tools / text / messages
- [src/analyzers/ContentSimilarityAnalyzer.ts](./src/analyzers/ContentSimilarityAnalyzer.ts)
  - Textual and structural similarity

### `src/scoring/`

- [src/scoring/ScoreCalculator.ts](./src/scoring/ScoreCalculator.ts)
  - Retains the legacy class name for compatibility
  - Its current responsibility is assembling the evaluation report
- [src/scoring/ReportGenerator.ts](./src/scoring/ReportGenerator.ts)
  - JSON / Markdown report generation

### `src/benchmark/`

- [src/benchmark/BenchmarkRunner.ts](./src/benchmark/BenchmarkRunner.ts)
  - Aggregates multiple reports
  - Outputs average warning count, average error count, and 95% CI
- [src/benchmark/Stats.ts](./src/benchmark/Stats.ts)
- Statistical computation (including bootstrap / Wilcoxon)
- [src/benchmark/ProcCtrlScorecard.ts](./src/benchmark/ProcCtrlScorecard.ts)
  - Qctx/Qtool/Qwf/Qeco/CP/PB scorecard with eta=0.70 and paper-aligned fragile success
- [src/benchmark/PaperControlPreservation.ts](./src/benchmark/PaperControlPreservation.ts)
  - Appendix A.5 five-subdimension CP and CPraw
- [src/benchmark/HierarchicalCalibration.ts](./src/benchmark/HierarchicalCalibration.ts)
  - Hierarchical Bayesian calibration: dev z-normalization, alpha/beta/gamma fitted on cal
- [src/benchmark/PaperArtifacts.ts](./src/benchmark/PaperArtifacts.ts)
  - Tables 1/2/4/5/6/7/8/10/12/13/14/15 and Figures 2a/3/4/5/7/8
- [src/benchmark/AnnotationSplit.ts](./src/benchmark/AnnotationSplit.ts)
  - Exact 80/40/80 stratified task-level split

Paper reproduction scripts: `scripts/create-annotation-template.ts`,
`export-annotation-split.ts`, `fit-hierarchical-calibration.ts`, `sample-paper-corpus.ts`,
`export-detector-specs.ts`, `run-ablation-study.ts`, `analyze-intervention-validation.ts`,
`analyze-common-environment.ts`, `paired-system-tests.ts`.

## Data Flow

```text
JSONL session
  -> ClaudeCodeStructure parsing
  -> AgentEvaluator
  -> per-dimension evaluators
  -> 11 detectors
  -> EvaluationResult
  -> ScoreCalculator (report assembly)
  -> EvaluationReport
  -> ReportGenerator
  -> JSON / Markdown report
```

## Output Directory

```text
output/
├── evaluation-reports/
├── benchmark/
├── file-graph.json
├── project-ast.json
└── prewarn.json
```

## Current Documentation Status

The following files are authoritative:

- [README.md](./README.md)
- [QUICKSTART.md](./QUICKSTART.md)
- [USAGE_GUIDE.md](./USAGE_GUIDE.md)
- [docs/metrics.md](./docs/metrics.md)
