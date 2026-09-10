# Usage Guide

## Current Evaluation Model

The current implementation is a non-scoring evaluation.

The core objects reported are:

- `taskOutcome`
  - `taskCompletionRate`
  - `outputExecutability`
  - `postModificationVerificationRate`
- Four problem dimensions
  - `contextManagement`
  - `toolUseEfficiency`
  - `workflowArchitecture`
  - `toolEcosystemConsistency`
- `diagnostics`
- `summary`

No longer returned:

- `totalScore`
- `overallAssessment`
- Dimension-level `score`

## Basic Invocation

```typescript
import { AgentEvaluator } from './src/AgentEvaluator';

async function evaluateSession() {
  const evaluator = await AgentEvaluator.fromJsonlFile('your-session.jsonl');
  const report = await evaluator.evaluate();

  console.log(report.summary.totalWarnings);
  console.log(report.summary.totalErrors);
  console.log(report.summary.keyIssues);
  console.log(report.dimensions.taskOutcome.details);
}
```

Save the report:

```typescript
await evaluator.evaluateAndSave('./output', ['json', 'markdown']);
```

## Project Analysis and AST Enhancement

### Configuration Entry Point

Project analysis configuration file:

- [config/project-analysis.config.json](./config/project-analysis.config.json)

Example:

```json
{
  "projectPath": "/path/to/target-project",
  "outputDir": "output",
  "relatedFilesDataPath": "/path/to/acoder/results/project-name"
}
```

### Execution

```bash
npm run analyze:project
```

### Artifacts

- [output/project-ast.json](./output/project-ast.json)
- [output/file-graph.json](./output/file-graph.json)

### Purpose

- `project-ast.json`
  - Which symbols a file defines
  - Which symbols a file uses
  - Which files are related to each other
  - How the code neighborhood expands
- `file-graph.json`
  - Supplements the "related files along the implementation chain" from external related files data

This data is consumed by detectors such as `DeadStep`, `DuplicateStep`, `LongChain`, `ToolChain`, and `InterfaceConsistency`.

## Report Structure

### Top-Level Fields

```json
{
  "runId": "a3d0cc87",
  "timestamp": "2026-04-08T12:00:00.000Z",
  "dimensions": {},
  "diagnostics": [],
  "summary": {}
}
```

### `dimensions.taskOutcome`

```json
{
  "warnings": 0,
  "errors": 0,
  "details": {
    "taskCompletionRate": 1,
    "outputExecutability": 0.75,
    "postModificationVerificationRate": 0.8
  }
}
```

Notes:

- This is a quality summary.
- These three values range from `0~1`.
- They describe the quality of the task outcome and are no longer aggregated into an externally reported total score.

### The Other Four Dimensions

Every dimension shares the same structure:

```json
{
  "warnings": 3,
  "errors": 1,
  "details": {
    "toolCallChain": {
      "warnings": 1,
      "errors": 1
    },
    "deadStep": {
      "warnings": 1,
      "errors": 0
    },
    "duplicateStep": {
      "warnings": 1,
      "errors": 0
    }
  }
}
```

### `diagnostics`

```json
{
  "metric": "deadStep",
  "severity": "warning",
  "message": "Dead step detected: the result of Read is never effectively referenced by the subsequent workflow",
  "location": {
    "toolUseId": "toolu_123"
  },
  "suggestion": "The result of this step appears to be unused. Consider removing this step or making sure its result is referenced by a subsequent step"
}
```

Notes:

- `deduction` is no longer exposed.
- Detectors may still keep severity weights internally, used for issue ranking and `keyIssues` selection.

### `summary`

```json
{
  "totalWarnings": 6,
  "totalErrors": 1,
  "keyIssues": [
    "Repetitive tool call chain detected: Read invoked 12 times in a row"
  ],
  "strengths": [
    "Consistent task completion quality",
    "High tool use efficiency"
  ]
}
```

## Configurable Items

The main configuration currently lives in [src/config/evaluation.config.ts](./src/config/evaluation.config.ts):

- `thresholds.ghostContext`
- `thresholds.oversizedRules`
- `thresholds.thrashing`
- `thresholds.toolChain`
- `thresholds.longChain`
- `contextWindowSize`

Example:

```typescript
import { DEFAULT_EVALUATION_CONFIG } from './src/config/evaluation.config';

const customConfig = {
  ...DEFAULT_EVALUATION_CONFIG,
  thresholds: {
    ...DEFAULT_EVALUATION_CONFIG.thresholds,
    toolChain: {
      repetitiveWarningCount: 8,
      repetitiveErrorCount: 12,
      cyclicWarningCount: 3,
      cyclicErrorCount: 5
    }
  }
};
```

## Benchmark Aggregation

`BenchmarkRunner` currently aggregates the warning count and error count of each dimension.

Output contents:

- Average warning count per dimension
- Average error count per dimension
- 95% CI
- A simple Cohen's d example over the first two reports

No longer aggregated:

- Average score
- Total score distribution
- Grade distribution

## Key Points of the Current Implementation

- `Write` is never judged as a `deadStep`.
- `LongChain` combines explicit subtasks, explicit checkpoints, implicit code cluster switches, and implicit verification checkpoints.
- `DuplicateStep` combines AST symbol overlap and file relationships to strengthen semantic duplication judgment.
- `InterfaceConsistency` and `WeakTool` are already wired into project-level AST / file relationship information.

## Recommended Reading Order

1. [README.md](./README.md)
2. [QUICKSTART.md](./QUICKSTART.md)
3. [docs/metrics.md](./docs/metrics.md)
4. [docs/benchmark_specs.md](./docs/benchmark_specs.md)
