# 基准评测方案

本方案对应当前实现：非评分制、可复验、以 issue 为中心。

## 1. 基本原则

- 评测仅依赖可重放轨迹与项目分析结果。
- 不依赖人工主观打分。
- 每个 benchmark 的输出是 issue，而不是分数。
- `taskOutcome` 输出质量摘要，不参与对外总分。

## 2. 数据来源

- JSONL 轨迹
  - `messages`
  - `toolUses`
  - `toolResults`
  - `replacements`
  - token usage
- AST
  - [src/analyzers/AstAnalyzer.ts](./src/analyzers/AstAnalyzer.ts)
- 项目关系
  - [output/project-ast.json](./output/project-ast.json)
- 外部 related files 数据
  - [output/file-graph.json](./output/file-graph.json)

## 3. issue 模型

每个 issue 包含：

- 指标名
- 严重度
- 位置
- 证据
- 建议

严重度分为：

- `warning`
- `error`

内部可以保留严重性权重用于排序，但不再输出总分、等级或维度分数。

## 4. 11 个基准

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

详细定义见：

- [docs/benchmark_specs.md](./docs/benchmark_specs.md)
- [docs/benchmark_evaluation_guide.md](./docs/benchmark_evaluation_guide.md)

## 5. `taskOutcome`

[src/evaluators/TaskOutcomeEvaluator.ts](./src/evaluators/TaskOutcomeEvaluator.ts) 输出：

- `taskCompletionRate`
- `outputExecutability`
- `postModificationVerificationRate`

它们是质量描述指标，不对外折算成总分。

## 6. 统计聚合

[src/benchmark/BenchmarkRunner.ts](./src/benchmark/BenchmarkRunner.ts) 当前做的是：

- 维度平均告警数
- 维度平均错误数
- Bootstrap 95% CI
- 前两份报告的示例性 Cohen's d

因此当前“统计显著性”是围绕 issue count 展开，而不是围绕分数展开。

## 7. 当前实现差异说明

相较旧版评分制文档，当前实现已经移除：

- `totalScore`
- `overallAssessment`
- 各维度 `score`
- 权重与扣分上限的对外语义

保留但仅用于内部排序的内容：

- `deduction`

## 8. 复验建议

- 先执行项目分析，再评估 session。
- 对关键 detector 准备正例和反例。
- 检查 `Write` 不会命中 `deadStep`。
- 检查 benchmark 汇总输出的是 warning/error 统计，而不是均分。
