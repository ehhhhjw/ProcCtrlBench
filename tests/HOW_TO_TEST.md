# 如何验证当前实现

## 1. 编译

```bash
npm install
npm run build
```

## 2. 运行示例

```bash
npm run example
```

## 3. 检查报告

确认：

- 没有 `totalScore`
- 没有 `overallAssessment`
- 没有维度 `score`
- `summary.totalWarnings` 和 `summary.totalErrors` 存在
- `taskOutcome.details` 存在

## 4. 检查 `deadStep`

准备包含 `Write` 的轨迹，确认不会因为 `Write` 而产生 `deadStep` issue。

## 5. 检查 Benchmark 汇总

如果有多份 JSON 报告：

```bash
npx ts-node src/benchmark/BenchmarkRunner.ts ./output/evaluation-reports ./output/benchmark/summary.md
```

确认输出的是：

- 平均告警数
- 平均错误数
- 95% CI

而不是平均分。
