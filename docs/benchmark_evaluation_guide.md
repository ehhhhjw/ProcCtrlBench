# 11项评测基准评测方案

本文件描述当前可执行方案：标准化事件表示 + AST / 文件图谱增强 + detector finding + 风险后验 + 控制保持 + 非评分制统计聚合。

## 总体说明

- 数据来源：
  - JSONL 轨迹
  - 项目 AST
  - 外部 related files 数据
- 输出形式：
  - issue
  - finding
  - posterior risk
  - control preservation
  - execution guidance
  - warning / error 统计
  - 任务结果质量摘要
- 统计形式：
  - 均值
  - 95% CI
  - 示例性效应量

## 通用能力

- AST：
  - [src/analyzers/AstAnalyzer.ts](./src/analyzers/AstAnalyzer.ts)
- 项目关系：
  - [src/analyzers/ProjectAstLoader.ts](./src/analyzers/ProjectAstLoader.ts)
- 外部 related files：
  - [src/analyzers/FileAssociationLoader.ts](./src/analyzers/FileAssociationLoader.ts)
- 代码上下文足迹：
  - [src/analyzers/CodeContextAnalyzer.ts](./src/analyzers/CodeContextAnalyzer.ts)

## 逐基准方案

### Ghost Context

- 看摘要与原文是否长期共存。
- 看大 payload 是否不可消费。
- 看原内容是否已失去后续代码上下文价值。

### Oversized Rules

- 看 `system` 消息体积。
- 看它在累计上下文中的占比。
- 看是否是最大的静态块。

### Context Thrashing

- 看读入后是否快速压缩。
- 看压缩前载入的代码上下文是否被后续复用。

### Tool Call Chain

- 看同名工具连续链。
- 看 2 到 4 长度的循环模式。
- 看是否满足批处理 / 搜索收敛豁免。

### Dead Step

- 看结果是否被后续工具输入引用。
- 看结果是否被 assistant 文本引用。
- 看是否触达相关文件、相关符号、相关邻域。
- 看是否导致分支变化。
- `Write` 永不判为 dead step。

### Duplicate Step

- 看输入结构相似度。
- 看中间相关文件是否变更。
- 看输出文本相似度。
- 看 AST 符号集合是否高度重合。

### Wrapper Workflow

- 看 Agent 是否只是透传。
- 看内部步骤是否极少。
- 看验证、转换、聚合逻辑是否缺失。

### Context Coupling

- 看调用图 SCC。
- 看交替模式。
- 看回边。
- 看代码邻域之间是否形成回流。

### Long Chain

- 看总链长。
- 看显式子任务。
- 看显式检查点。
- 看隐式代码簇切换。
- 看隐式验证回读。

### Interface Inconsistency

- 看 schema 差异。
- 看结果形态差异。
- 看符号类型分布差异。
- 看同一代码邻域中的接口风险。

### Weak Tool

- 看适用任务数和实际调用数。
- 看替代工具是否挤占调用。
- 看项目 AST 增强后的适用场景机会识别。

## 当前输出口径

### 单报告

- 每维度 `warnings`
- 每维度 `errors`
- `taskOutcome.details`
- `diagnostics`
- `findings`
- `risk`
- `controlPreservation`
- `executionGuidance`
- `summary`

### 多报告

- 平均告警数
- 平均错误数
- `overallRisk`
- `averagePosteriorRisk`
- `controlPreservation.score`
- `executionGuidance.autonomyLevel`
- `taskCompletionRate`
- `outputExecutability`
- `postModificationVerificationRate`
- 95% CI

## 当前不再使用的口径

以下口径属于旧版文档，不再代表当前实现：

- 总分
- 评级
- 按权重加权
- 维度分数

## 方法链路

当前实现按下面链路组织评测逻辑：

`执行轨迹 -> 标准化 issue / finding -> detectorScore -> posteriorRisk -> warning/error 风险语义 -> controlPreservation -> executionGuidance`

说明：

- `issue` 仍是 detector 的直接输出，保留原有兼容口径。
- `finding` 是标准化过程信号，显式记录 `metric`、`dimension`、`detectorScore`、`posteriorRisk`、`riskSeverity`。
- `posteriorRisk` 当前采用 `heuristic-bayesian-proxy`，用经验先验、严重度锚点、证据强度和 detector score 做轻量后验估计。
- `controlPreservation` 是独立于缺陷数量的补充维度，衡量执行过程中的可理解、可干预、可修正、可回退和判断权交还。
- `executionGuidance` 用于把风险层反馈回执行层，适配后续 runtime guard / sidecar 治理。

## 推荐联读

- [docs/benchmark_specs.md](./docs/benchmark_specs.md)
- [docs/current_benchmark_schemes.md](./docs/current_benchmark_schemes.md)
- [docs/metrics.md](./docs/metrics.md)
