# 11基准测试计划（可复验）

- 样本集：每类任务≥30；每任务≥5次试验（不同seed/初始提示/工具可见性）。
- 数据采集：保存 `output/evaluation-reports/*.json` 与 `output/file-graph.json`；记录依赖版本与随机种子。
- 验证项：
  - DeadStep/DuplicateStep：AST符号引用、文件图谱间接引用、生效率与误报率。
  - Thrashing：窗口阈值75%预警有效性；a/b场景区分的正确率。
  - Wrapper/Coupling/Chain：结构性指标（SCC、序列熵）与建议注入的干预效果。
  - Interface/Weak：差异度与分散度显著性；Prompt变异前后效应量。
- 统计：`src/benchmark/BenchmarkRunner.ts` 输出均值±95%CI；必要时配对t检与效果量报告。
- 通过准则：在≥80%任务上，指标的检出/改进建议具备统计显著性（p<0.05，d≥0.5）且工程师复核认可。
