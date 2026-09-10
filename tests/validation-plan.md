# 验证计划

## 目标

验证当前实现与文档一致，尤其是：

- 非评分制
- AST 增强
- related files 接入
- `Write` 不算 `deadStep`

## 代码级检查点

- [src/types/evaluation.types.ts](./src/types/evaluation.types.ts)
- [src/scoring/ScoreCalculator.ts](./src/scoring/ScoreCalculator.ts)
- [src/scoring/ReportGenerator.ts](./src/scoring/ReportGenerator.ts)
- [src/detectors/DeadStepDetector.ts](./src/detectors/DeadStepDetector.ts)
- [src/benchmark/BenchmarkRunner.ts](./src/benchmark/BenchmarkRunner.ts)

## 报告级检查点

- 顶层没有 `totalScore`
- `summary` 中没有 `overallAssessment`
- `dimensions.*` 中没有 `score`
- `diagnostics` 不暴露 `deduction`

## 行为级检查点

- 项目 AST 存在时，`DeadStep` / `DuplicateStep` / `LongChain` / `InterfaceConsistency` 行为会利用项目关系
- 外部 related files 数据存在时，文件图谱应进入分析流程
- `Write` 操作本身不应被判为 dead step
