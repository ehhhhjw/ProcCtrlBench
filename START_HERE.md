# 开始使用

先按下面顺序阅读：

1. [QUICKSTART.md](./QUICKSTART.md)
2. [USAGE_GUIDE.md](./USAGE_GUIDE.md)
3. [docs/benchmark_specs.md](./docs/benchmark_specs.md)

## 你需要先知道的事

- 单会话诊断报告是非评分制的，不输出 100 分制分数。
- 论文复现层（`src/benchmark/*`、`scripts/*paper*`）会输出 `Qctx/Qtool/Qwf/Qeco/CP/PB`
  记分卡；`PB` 使用论文 v8 的 `eta = 0.70`。
- 如果你要启用 AST 与项目关系增强，先配置项目分析，再评估 session。
- 论文复现的数据要求与脚本见 [docs/reproducing_paper_results.md](./docs/reproducing_paper_results.md)。

## 最短路径

```bash
npm install
npm run build
npm run example
```

如果你要分析真实项目：

```bash
npm run analyze:project
```

配置文件：

- [config/project-analysis.config.json](./config/project-analysis.config.json)

关键产物：

- [output/project-ast.json](./output/project-ast.json)
- [output/file-graph.json](./output/file-graph.json)
- [output/evaluation-reports](./output/evaluation-reports)

## 当前报告里看什么

- `summary.totalWarnings`
- `summary.totalErrors`
- `summary.keyIssues`
- `summary.strengths`
- `dimensions.taskOutcome.details`
- 各维度的 `warnings` / `errors`

如果你看到旧文档里还有 `totalScore`、`overallAssessment`、维度 `score`，那是旧版评分制遗留描述，不代表当前实现。
