# 项目结构

## 顶层目录

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

### 入口

- [src/AgentEvaluator.ts](./src/AgentEvaluator.ts)
  - 主评估入口
  - 串联 5 个维度评估器
- [src/index.ts](./src/index.ts)
  - 公共导出

### `src/types/`

- [src/types/evaluation.types.ts](./src/types/evaluation.types.ts)
  - `EvaluationConfig`
  - `EvaluationResult`
  - `EvaluationReport`
  - `DetectionIssue`
- [src/types/metrics.types.ts](./src/types/metrics.types.ts)
  - 各 detector 辅助类型

### `src/config/`

- [src/config/evaluation.config.ts](./src/config/evaluation.config.ts)
  - 阈值配置
  - 上下文窗口大小
- [config/project-analysis.config.json](./config/project-analysis.config.json)
  - 项目路径
  - 输出目录
  - 外部 related files 数据路径

### `src/evaluators/`

- [src/evaluators/BaseEvaluator.ts](./src/evaluators/BaseEvaluator.ts)
  - 通用 issue 统计
- [src/evaluators/TaskOutcomeEvaluator.ts](./src/evaluators/TaskOutcomeEvaluator.ts)
  - 任务结果质量摘要
- [src/evaluators/ContextManagementEvaluator.ts](./src/evaluators/ContextManagementEvaluator.ts)
- [src/evaluators/ToolUseEfficiencyEvaluator.ts](./src/evaluators/ToolUseEfficiencyEvaluator.ts)
- [src/evaluators/WorkflowArchitectureEvaluator.ts](./src/evaluators/WorkflowArchitectureEvaluator.ts)
- [src/evaluators/ToolEcosystemEvaluator.ts](./src/evaluators/ToolEcosystemEvaluator.ts)

说明：

- evaluator 现在不再产出分数。
- 产出的是 `warnings`、`errors`、`issues` 和 `details`。

### `src/detectors/`

11 个基准对应的 detector：

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
  - tree-sitter 多语言 AST
- [src/analyzers/ProjectAstLoader.ts](./src/analyzers/ProjectAstLoader.ts)
  - 项目 AST 关系加载
- [src/analyzers/FileAssociationLoader.ts](./src/analyzers/FileAssociationLoader.ts)
  - 外部 related files 图谱加载
- [src/analyzers/CodeContextAnalyzer.ts](./src/analyzers/CodeContextAnalyzer.ts)
  - 工具 / 文本 / 消息的代码上下文足迹
- [src/analyzers/ContentSimilarityAnalyzer.ts](./src/analyzers/ContentSimilarityAnalyzer.ts)
  - 文本与结构相似度

### `src/scoring/`

- [src/scoring/ScoreCalculator.ts](./src/scoring/ScoreCalculator.ts)
  - 兼容旧类名
  - 当前职责是评估报告组装
- [src/scoring/ReportGenerator.ts](./src/scoring/ReportGenerator.ts)
  - JSON / Markdown 报告生成

### `src/benchmark/`

- [src/benchmark/BenchmarkRunner.ts](./src/benchmark/BenchmarkRunner.ts)
  - 聚合多份报告
  - 输出平均告警数、平均错误数和 95% CI
- [src/benchmark/Stats.ts](./src/benchmark/Stats.ts)
  - 统计计算

## 数据流

```text
JSONL 会话
  -> ClaudeCodeStructure 解析
  -> AgentEvaluator
  -> 各维度 evaluator
  -> 11 个 detector
  -> EvaluationResult
  -> ScoreCalculator(报告组装)
  -> EvaluationReport
  -> ReportGenerator
  -> JSON / Markdown 报告
```

## 输出目录

```text
output/
├── evaluation-reports/
├── benchmark/
├── file-graph.json
├── project-ast.json
└── prewarn.json
```

## 当前文档状态

以以下文件为准：

- [README.md](./README.md)
- [QUICKSTART.md](./QUICKSTART.md)
- [USAGE_GUIDE.md](./USAGE_GUIDE.md)
- [docs/metrics.md](./docs/metrics.md)
