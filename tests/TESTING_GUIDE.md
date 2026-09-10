# 测试指南

当前测试与验证应围绕非评分制输出进行。

## 核心检查项

### 报告结构

- 不应存在 `totalScore`
- 不应存在 `overallAssessment`
- 不应存在维度 `score`
- `summary.totalWarnings` / `summary.totalErrors` 必须存在
- `diagnostics` 不应暴露 `deduction`

### 任务结果

- `taskCompletionRate` 必须在 `0~1`
- `outputExecutability` 必须在 `0~1`
- `postModificationVerificationRate` 必须在 `0~1`

### 基准规则

- `Write` 不能被判为 `deadStep`
- `DuplicateStep` 应考虑 AST 符号重合度
- `LongChain` 应考虑显式与隐式阶段切分
- `InterfaceConsistency` / `WeakTool` 应能使用项目 AST 和 related files 数据

### 聚合

- `BenchmarkRunner` 只能聚合 warning/error 统计
- 不应再计算平均分或评级

## 建议验证方式

1. 运行 `npm run build`
2. 运行 `npm run example`
3. 检查生成的 JSON / Markdown 报告字段
4. 准备带项目 AST 的用例和不带项目 AST 的用例，比较 detector 行为差异
