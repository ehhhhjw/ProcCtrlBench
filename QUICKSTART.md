# 快速开始指南

本指南对应单会话诊断层：非评分制、AST 增强、项目级文件关系增强。

论文复现层（11 缺陷记分卡、η=0.70、CP、层次贝叶斯校准、Table 1-15）见
[docs/reproducing_paper_results.md](./docs/reproducing_paper_results.md)。

## 1. 安装与编译

```bash
npm install
npm run build
```

## 2. 可选：先做项目分析

在 [config/project-analysis.config.json](./config/project-analysis.config.json) 里配置：

```json
{
  "projectPath": "/path/to/target-project",
  "outputDir": "output",
  "relatedFilesDataPath": "/path/to/acoder/results/project-name"
}
```

然后执行：

```bash
npm run analyze:project
```

这一步会生成：

- [output/project-ast.json](./output/project-ast.json)
- [output/file-graph.json](./output/file-graph.json)

## 3. 运行示例评估

```bash
npm run example
```

你会看到类似输出：

```text
开始评估 Run ID: a3d0cc87
评估工具使用效率...
  - 告警: 3, 错误: 1
评估工作流架构...
  - 告警: 2, 错误: 0
评估上下文管理...
  - 告警: 1, 错误: 0
评估工具生态一致性...
  - 告警: 0, 错误: 0
评估任务结果...
  - 完成率: 100%, 可执行性: 75%, 验证率: 80%
生成评估报告...
评估完成! 已生成非评分制诊断报告
总告警: 6, 总错误: 1
```

## 4. 查看报告

生成目录：

- [output/evaluation-reports](./output/evaluation-reports)

JSON 报告重点看：

- `summary.totalWarnings`
- `summary.totalErrors`
- `summary.keyIssues`
- `dimensions.taskOutcome.details`
- `dimensions.contextManagement/details`
- `diagnostics`

Markdown 报告重点看：

- 概览
- 维度摘要
- 关键问题
- 详细诊断

## 5. 最小调用示例

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

## 6. 批量基准汇总

如果目录里已经有多份 JSON 报告，可以运行：

```bash
npx ts-node src/benchmark/BenchmarkRunner.ts ./output/evaluation-reports ./output/benchmark/summary.md
```

当前汇总输出的是：

- 每个维度的平均告警数
- 每个维度的平均错误数
- 对应 95% CI

不再输出平均分或评级。
