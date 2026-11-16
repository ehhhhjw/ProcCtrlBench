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

## 5. 与论文 v8 实验的真实对应关系

### 已具备的执行链路

- 三个 benchmark 的真实公开轨迹离线评测；
- 11 个 defect 的触发统计与连续证据分 `defectSignals`；
- 论文 Appendix A.5 的 CP（`controlPreservationSource = paper-appendix-a5`）与 CPraw；
- η=0.70 的 PB、论文口径 fragile success；
- 11 系统语料采样与 gap report（`scripts/sample-paper-corpus.ts`）；
- 标注模板、精确 80/40/80 划分（`create-annotation-template.ts` / `export-annotation-split.ts`）；
- 层次贝叶斯校准（`fit-hierarchical-calibration.ts`）；
- split-aware Table 13/14、Table 4/5、Table 3/9/11/15 脚本；
- task-grouped paired bootstrap + Wilcoxon（`paired-system-tests.ts`）。

### 仍需要作者数据才能严格完成

| 论文产物 | 缺失输入 |
|---|---|
| Table 1 / Table 7 / Table 13 / Figure 7 | 200 条双标注 + 仲裁的过程级标注集 |
| Table 2 / Table 6 / Table 8 / Table 10 / Table 12 / Table 14 | 11 系统 × 50 任务的匹配轨迹语料 |
| Table 4 / Table 5 | 标注集 + split |
| Table 9 | held-out intervention/breakdown 标签 |
| Table 11 | 44 条主动干预 run |
| Table 15 | 4 模型共同 OpenCode 环境 run |

### 当前公开数据的边界

- `external_data/` 中的 Android/Terminal/SWE 轨迹是公开观测运行，不是论文的 11 系统匹配矩阵；
- `output/paper-*-experiments*` 中的旧记录缺 `pb/qDef/defectSignals`，必须用当前代码重跑；
- `output/calibration/detector-profile.json` 是 1 条 finding 的演示拟合，不能用于论文校准。

## 6. 真实性约束

- `observed-public-run` 仅表示“真实公开轨迹的离线评测结果”，**不等价于**论文中的 11 个系统；
- 如果缺少人工标注、匹配语料或干预数据，输出必须保留 `blocked` / `partial` 状态；
- `scripts/sample-paper-corpus.ts` 只选择已有轨迹，不会补造缺失 run；
- 论文口径 fragile success 为 `PB < 0.65` 或至少 2 个 `p_j >= 0.70`；旧的 CP 均值相对定义仅保留为描述性统计。
