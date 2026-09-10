# 评测基准方案总览

本文整合当前实现下 11 个评测基准的定义、信号、阈值、误报控制和整改建议。当前实现是非评分制，issue 的严重度用于诊断和排序，不生成总分。

## 通用增强

- AST 符号级分析：
  - [src/analyzers/AstAnalyzer.ts](./src/analyzers/AstAnalyzer.ts)
- 项目分析入口：
  - [config/project-analysis.config.json](./config/project-analysis.config.json)
  - [scripts/build-file-graph.ts](./scripts/build-file-graph.ts)
- 项目 AST：
  - [output/project-ast.json](./output/project-ast.json)
- 文件图谱：
  - [output/file-graph.json](./output/file-graph.json)
- 预警：
  - [output/prewarn.json](./output/prewarn.json)

## 1. Ghost Context

- 阈值：
  - warning `512`
  - error `1024`
- 典型 issue：
  - 摘要与原文长时间共存
  - 不可消费 payload
  - 有摘要但后续不再引用的历史结果

## 2. Oversized Rules

- 阈值：
  - token warning `2000`
  - token error `4000`
  - ratio warning `0.20`
  - ratio error `0.35`
- 典型 issue：
  - `system` 规则过大
  - `system` 规则占比过高
  - `system` 规则成为最大静态块

## 3. Context Thrashing

- 阈值：
  - `windowThreshold = 0.75`
  - `compressionLookAhead = 2`
- 典型 issue：
  - timing fault
  - payload oversize fault

## 4. Tool Call Chain

- 阈值：
  - repetitive warning `6`
  - repetitive error `10`
  - cyclic warning `3`
  - cyclic error `5`
- 豁免：
  - 多样输入
  - 合理批处理
  - 收敛搜索

## 5. Dead Step

- 关键检查：
  - 后续工具输入引用
  - assistant 文本引用
  - 文件操作引用
  - 分支变化
- 当前规则：
  - `Write` 不是 dead step
- 增强：
  - AST 符号引用
  - 项目 related files 间接引用

## 6. Duplicate Step

- 关键检查：
  - 输入结构相似度
  - 中间无相关文件变更
  - 输出相似度
  - AST 符号 Jaccard 重合度
- 豁免：
  - 时变命令
  - 测试型重复命令

## 7. Wrapper Workflow

- 统计起点：
  - 同一 Agent 至少调用 `5` 次才开始判定
- 典型信号：
  - 内部步骤少
  - 单一下游工具类型
  - 输入输出高度相似
  - 无验证
  - 符号增量低

## 8. Context Coupling

- 典型信号：
  - SCC
  - 交替调用
  - 回边
  - 代码邻域回流

## 9. Long Chain

- 阈值：
  - effective warning `12`
  - effective error `20`
  - simple warning `25`
  - simple error `40`
- 增强：
  - 隐式子任务识别
  - 隐式检查点识别

## 10. Interface Inconsistency

- 典型信号：
  - 参数名差异
  - 参数类型差异
  - 结果形态差异
  - 结果符号类型差异
  - 语义重合度高但接口仍不一致

## 11. Weak Tool

- 典型信号：
  - 调用率低
  - 替代工具高频出现
  - 项目 AST 增强后仍然低触发

## Task Outcome

当前是质量摘要，不是评分项。

- `taskCompletionRate`
- `outputExecutability`
- `postModificationVerificationRate`

## 聚合方式

[src/benchmark/BenchmarkRunner.ts](./src/benchmark/BenchmarkRunner.ts) 当前输出：

- 平均告警数
- 平均错误数
- 95% CI

如果需要 before / after 对比，建议比较：

- 总告警数变化
- 总错误数变化
- 关键 issue 是否消失
- `taskOutcome.details` 是否改善
