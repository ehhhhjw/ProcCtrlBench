# ProcBench 真实离线实验协议

本协议把当前仓库能够**真实执行**的部分和**无法严格复现**的论文实验边界分开说明，避免把缺失数据误写成已完成结果。

## 1. 数据来源

- AndroidBench 真实轨迹根目录：
  `./external_data/android_bench`
- TerminalBench 真实轨迹根目录：
  `./external_data/terminal_bench`
- SWE-bench-Verified 真实轨迹根目录：
  `~/Desktop/swe-bench-experiments/evaluation/verified/20240620_sweagent_claude3.5sonnet/trajs`
- SWE verified project 代码：
  `~/Desktop/C_Project/swebench_verified_projects/projects`

## 2. 已对齐到论文的方法链

当前仓库已真实打通：

`raw trajectory -> unified SessionData / StandardEvent-like view -> 11 detectors -> finding -> posterior risk -> control preservation -> execution guidance -> structured aggregate tables`

对应实现：

- benchmark 轨迹适配：
  [src/adapters/BenchmarkTrajectoryLoader.ts](./src/adapters/BenchmarkTrajectoryLoader.ts)
- 真实离线实验入口：
  [scripts/run-paper-offline-experiments.ts](./scripts/run-paper-offline-experiments.ts)
- 论文风格聚合：
  [src/benchmark/ObservedBenchmarkExperiments.ts](./src/benchmark/ObservedBenchmarkExperiments.ts)

## 3. 执行步骤

### Step 1. 运行测试

```bash
npm test
```

### Step 2. 续传 SWE 轨迹

```bash
source .bench_env/bin/activate
cd ~/Desktop/swe-bench-experiments
python analysis/download_logs.py evaluation/verified/20240620_sweagent_claude3.5sonnet --only_trajs --skip_existing
```

### Step 3. 执行三 benchmark 的真实离线评测

```bash
PROC_BENCH_DISABLE_TREE_SITTER=1 npx ts-node scripts/run-paper-offline-experiments.ts \
  --android-root external_data/android_bench \
  --terminal-root external_data/terminal_bench \
  --swe-root ~/Desktop/swe-bench-experiments/evaluation/verified/20240620_sweagent_claude3.5sonnet/trajs \
  --output output/paper-offline-experiments \
  --resume true \
  --quiet true
```

如需保留每条轨迹的完整 JSON 报告：

```bash
PROC_BENCH_DISABLE_TREE_SITTER=1 npx ts-node scripts/run-paper-offline-experiments.ts \
  --android-root external_data/android_bench \
  --terminal-root external_data/terminal_bench \
  --swe-root ~/Desktop/swe-bench-experiments/evaluation/verified/20240620_sweagent_claude3.5sonnet/trajs \
  --output output/paper-offline-experiments \
  --resume true \
  --quiet true \
  --save-reports true
```

## 4. 输出物

脚本会生成：

- `trajectory-records.jsonl`
- `trajectory-records.csv`
- `observed-benchmark-summary.csv`
- `observed-benchmark-summary.md`
- `defect-failure-correlation-overall.csv`
- `defect-failure-correlation-by-benchmark.csv`
- `swe-control-preservation.csv`
- `reproduction-status.md`
- `trajectory-failures.jsonl`（如有失败）

说明：

- `PROC_BENCH_DISABLE_TREE_SITTER=1` 会禁用原生 tree-sitter 解析，强制 AST 提取退化为正则 fallback。
- 这是为了保证公开大轨迹批量评测的稳定性；不影响标准化事件、11 detectors、风险和控制保持主链路执行。

## 5. 与论文实验的真实对应关系

### 可真实完成

- 三个 benchmark 的真实公开轨迹离线评测
- 11 个 defect benchmark 的触发统计
- 过程风险、控制保持、执行引导的结构化汇总
- SWE 上的真实 control preservation 统计
- defect trigger 与任务失败的离线相关性分析

### 当前无法严格完成

- RQ1 Table 1 的 detector-vs-human precision / recall / F1 / AP / AUROC
  原因：论文描述的 200 条人工标注轨迹集不在当前工作区，也没有可验证的公开标注文件。
- RQ2 Table 2 / Figure 3 的严格 calibration 实验
  原因：缺少同一标注集上的真实 defect label。
- RQ3 Table 3 / Table 4 的 `Baseline / Detector-Only / W+E-Guidance` 三配置重跑对照
  原因：当前只有公开观测轨迹，不是同一任务在三种治理配置下的 matched reruns。
- RQ4 Table 5 / Figure 4 的 baseline vs guidance 严格对照
  原因：当前只有 observed public runs，没有 W+E-guidance 重跑轨迹。

## 6. 真实性约束

- `observed-public-run` 仅表示“真实公开轨迹的离线 ProcBench 评测结果”，**不等价于**论文中的 `Baseline`。
- 如果缺少人工标注或 matched reruns，输出必须保留 `blocked` / `partial` 状态，不能用论文中的临时数字替代。
- `swe-control-preservation.csv` 中的 fragile-success 使用论文定义的可操作化近似：
  成功轨迹中，`CP < 当前样本均值` 且 `Long Chain` 或 `Dead Step` 被触发。
