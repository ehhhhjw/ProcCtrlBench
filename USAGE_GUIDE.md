# 使用指南

## 当前评估模型

当前实现是非评分制评估。

报告的核心对象是：

- `taskOutcome`
  - `taskCompletionRate`
  - `outputExecutability`
  - `postModificationVerificationRate`
- 四个问题维度
  - `contextManagement`
  - `toolUseEfficiency`
  - `workflowArchitecture`
  - `toolEcosystemConsistency`
- `diagnostics`
- `summary`

不再返回：

- `totalScore`
- `overallAssessment`
- 维度级 `score`

## 基本调用

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

保存报告：

```typescript
await evaluator.evaluateAndSave('./output', ['json', 'markdown']);
```

## 项目分析与 AST 增强

### 配置入口

项目分析配置文件：

- [config/project-analysis.config.json](./config/project-analysis.config.json)

示例：

```json
{
  "projectPath": "/path/to/target-project",
  "outputDir": "output",
  "relatedFilesDataPath": "/path/to/acoder/results/project-name"
}
```

### 执行

```bash
npm run analyze:project
```

### 产物

- [output/project-ast.json](./output/project-ast.json)
- [output/file-graph.json](./output/file-graph.json)

### 作用

- `project-ast.json`
  - 文件定义了哪些符号
  - 文件使用了哪些符号
  - 哪些文件彼此相关
  - 代码邻域如何扩展
- `file-graph.json`
  - 从外部 related files 数据补充“实现链路上的相关文件”

这些数据会被 `DeadStep`、`DuplicateStep`、`LongChain`、`ToolChain`、`InterfaceConsistency` 等检测器使用。

## 报告结构

### 顶层字段

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

说明：

- 这是质量摘要。
- 这三个值范围是 `0~1`。
- 它们用于描述任务结果质量，不再对外汇总成总分。

### 其他四个维度

每个维度结构一致：

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
  "message": "检测到死步骤: Read 的结果未被后续流程有效引用",
  "location": {
    "toolUseId": "toolu_123"
  },
  "suggestion": "该步骤的结果似乎未被使用。考虑移除此步骤或确保其结果被后续步骤引用"
}
```

说明：

- 不再暴露 `deduction`。
- detector 内部仍可能保留严重性权重，用于 issue 排序和 `keyIssues` 选择。

### `summary`

```json
{
  "totalWarnings": 6,
  "totalErrors": 1,
  "keyIssues": [
    "检测到重复工具调用链: Read 连续调用 12 次"
  ],
  "strengths": [
    "任务完成质量稳定",
    "工具使用效率高"
  ]
}
```

## 可配置项

当前主要配置在 [src/config/evaluation.config.ts](./src/config/evaluation.config.ts)：

- `thresholds.ghostContext`
- `thresholds.oversizedRules`
- `thresholds.thrashing`
- `thresholds.toolChain`
- `thresholds.longChain`
- `contextWindowSize`

示例：

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

## Benchmark 汇总

`BenchmarkRunner` 当前聚合的是各维度的告警数和错误数。

输出内容：

- 每维度平均告警数
- 每维度平均错误数
- 95% CI
- 前两份报告的简单 Cohen's d 示例

不再聚合：

- 平均分
- 总分分布
- 等级分布

## 当前实现中的几个关键点

- `Write` 不会被判定为 `deadStep`。
- `LongChain` 会结合显式子任务、显式检查点、隐式代码簇切换和隐式验证检查点。
- `DuplicateStep` 会结合 AST 符号重合度和文件关系增强语义重复判断。
- `InterfaceConsistency` 和 `WeakTool` 已接入项目级 AST / 文件关系信息。

## 推荐阅读顺序

1. [README.md](./README.md)
2. [QUICKSTART.md](./QUICKSTART.md)
3. [docs/metrics.md](./docs/metrics.md)
4. [docs/benchmark_specs.md](./docs/benchmark_specs.md)
