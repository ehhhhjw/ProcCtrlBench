# Getting Started

Read the following in order first:

1. [QUICKSTART.md](./QUICKSTART.md)
2. [USAGE_GUIDE.md](./USAGE_GUIDE.md)
3. [docs/benchmark_specs.md](./docs/benchmark_specs.md)

## What You Need to Know First

- The current system is non-scoring.
- The output is a diagnostic report, not a score on a 100-point scale.
- If you want to enable the AST and project relationship enhancements, configure project analysis first, then evaluate the session.

## Shortest Path

```bash
npm install
npm run build
npm run example
```

If you want to analyze a real project:

```bash
npm run analyze:project
```

Configuration file:

- [config/project-analysis.config.json](./config/project-analysis.config.json)

Key artifacts:

- [output/project-ast.json](./output/project-ast.json)
- [output/file-graph.json](./output/file-graph.json)
- [output/evaluation-reports](./output/evaluation-reports)

## What to Look At in the Current Report

- `summary.totalWarnings`
- `summary.totalErrors`
- `summary.keyIssues`
- `summary.strengths`
- `dimensions.taskOutcome.details`
- The `warnings` / `errors` of each dimension

If you still see `totalScore`, `overallAssessment`, or dimension-level `score` in older documentation, those are leftover descriptions from the previous scoring-based version and do not reflect the current implementation.
