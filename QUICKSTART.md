# Quick Start Guide

This guide covers the single-session diagnostic layer: non-scoring, AST-enhanced, and enhanced with project-level file relationships.

The paper reproduction layer (11-defect scorecard, eta=0.70, CP, hierarchical Bayesian calibration, Tables 1-15) is documented in
[docs/reproducing_paper_results.md](./docs/reproducing_paper_results.md).

## 1. Install and Build

```bash
npm install
npm run build
```

## 2. Optional: Run Project Analysis First

Configure it in [config/project-analysis.config.json](./config/project-analysis.config.json):

```json
{
  "projectPath": "/path/to/target-project",
  "outputDir": "output",
  "relatedFilesDataPath": "/path/to/acoder/results/project-name"
}
```

Then run:

```bash
npm run analyze:project
```

This step generates:

- [output/project-ast.json](./output/project-ast.json)
- [output/file-graph.json](./output/file-graph.json)

## 3. Run the Example Evaluation

```bash
npm run example
```

You will see output similar to:

```text
Starting evaluation, Run ID: a3d0cc87
Evaluating tool use efficiency...
  - Warnings: 3, Errors: 1
Evaluating workflow architecture...
  - Warnings: 2, Errors: 0
Evaluating context management...
  - Warnings: 1, Errors: 0
Evaluating tool ecosystem consistency...
  - Warnings: 0, Errors: 0
Evaluating task outcome...
  - Completion rate: 100%, Executability: 75%, Verification rate: 80%
Generating evaluation report...
Evaluation complete! Non-scoring diagnostic report generated
Total warnings: 6, Total errors: 1
```

## 4. Review the Report

Output directory:

- [output/evaluation-reports](./output/evaluation-reports)

In the JSON report, focus on:

- `summary.totalWarnings`
- `summary.totalErrors`
- `summary.keyIssues`
- `dimensions.taskOutcome.details`
- `dimensions.contextManagement/details`
- `diagnostics`

In the Markdown report, focus on:

- Overview
- Dimension summary
- Key issues
- Detailed diagnostics

## 5. Minimal Invocation Example

```typescript
import { AgentEvaluator } from './src/AgentEvaluator';

async function main() {
  const evaluator = await AgentEvaluator.fromJsonlFile('./path/to/session.jsonl');
  const report = await evaluator.evaluateAndSave('./output');

  console.log(report.summary.totalWarnings);
  console.log(report.summary.totalErrors);
  console.log(report.dimensions.taskOutcome.details.taskCompletionRate);
}

main();
```

## 6. Batch Benchmark Aggregation

If a directory already contains multiple JSON reports, you can run:

```bash
npx ts-node src/benchmark/BenchmarkRunner.ts ./output/evaluation-reports ./output/benchmark/summary.md
```

The aggregation currently outputs:

- Average warning count per dimension
- Average error count per dimension
- The corresponding 95% CI

Average scores and grades are no longer output.
