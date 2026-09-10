# 评测指标实现总览

本文件描述当前代码实现下的指标体系。当前系统是非评分制评估，重点是：

- 产生 issue
- 产生 finding
- 输出 posterior risk
- 输出 control preservation
- 输出 execution guidance
- 统计 warning / error
- 输出任务结果质量摘要
- 支持跨报告统计聚合

## 实现位置

- 阈值配置：
  - [src/config/evaluation.config.ts](./src/config/evaluation.config.ts)
- 类型定义：
  - [src/types/evaluation.types.ts](./src/types/evaluation.types.ts)
- 检测器：
  - [src/detectors](./src/detectors)
- 评估器：
  - [src/evaluators](./src/evaluators)
- AST / 文件关系分析：
  - [src/analyzers](./src/analyzers)
- 报告组装与输出：
  - [src/scoring/ScoreCalculator.ts](./src/scoring/ScoreCalculator.ts)
  - [src/scoring/ReportGenerator.ts](./src/scoring/ReportGenerator.ts)

## 报告模型

### `taskOutcome`

`taskOutcome` 不再汇总成总分，只输出三个质量指标：

- `taskCompletionRate`
- `outputExecutability`
- `postModificationVerificationRate`

### 4 个 issue 维度

- 上下文管理
- 工具使用效率
- 工作流架构
- 工具生态一致性

每个维度输出：

- `warnings`
- `errors`
- `details`
- `issues`

### `diagnostics`

对外暴露：

- `metric`
- `severity`
- `message`
- `location`
- `suggestion`
- `evidence`

内部 detector 仍可使用 `deduction` 作为严重性权重，但它不再进入最终报告的对外 schema。

### `findings`

`findings` 是对 `diagnostics` 的标准化过程投影，新增：

- `dimension`
- `detectorScore`
- `posteriorRisk`
- `riskSeverity`
- `evidenceStrength`
- `exemptionsApplied`
- `conditionSignals`

### `risk`

`risk` 是过程型风险聚合层，当前实现输出：

- `overallRisk`
- `averagePosteriorRisk`
- `warningFindings`
- `errorFindings`
- `topRiskFindings`
- 各一级维度 `averagePosteriorRisk` / `maxPosteriorRisk`

### `controlPreservation`

`controlPreservation` 用于衡量控制保持能力，包含：

- `interpretability`
- `interruptibility`
- `corrigibility`
- `reversibility`
- `handoffAwareness`
- 总分 `score`
- 等级 `level`

### `executionGuidance`

`executionGuidance` 将过程风险反馈为治理动作建议，当前输出：

- `autonomyLevel`
- `recommendedActions`
- `rationale`

## 11 个基准

### 1. Ghost Context

- 实现：
  - [src/detectors/GhostContextDetector.ts](./src/detectors/GhostContextDetector.ts)
  - [src/analyzers/ContextChainAnalyzer.ts](./src/analyzers/ContextChainAnalyzer.ts)
- 检查：
  - 摘要与原文共存
  - 不可消费的大 payload
  - 有摘要但原始结果后续未再被引用
- 增强：
  - 结合 `CodeContextAnalyzer`
  - 结合 `project-ast.json` 判断代码上下文是否仍活跃

### 2. Oversized Rules

- 实现：
  - [src/detectors/OversizedRulesDetector.ts](./src/detectors/OversizedRulesDetector.ts)
- 检查：
  - `system` 消息体积
  - 在上下文中的占比
  - 是否为最大静态内容块

### 3. Context Thrashing

- 实现：
  - [src/detectors/ThrashingDetector.ts](./src/detectors/ThrashingDetector.ts)
  - [src/analyzers/ContextChainAnalyzer.ts](./src/analyzers/ContextChainAnalyzer.ts)
- 检查：
  - 接近窗口上限时载入大对象
  - 载入后 2 步内发生压缩
  - 压缩前代码上下文没有得到有效复用
- 说明：
  - 当前窗口占用统计按真实祖先链计算，不再把无关 sibling 分支的 token 混入当前 step。

### 4. Tool Call Chain

- 实现：
  - [src/detectors/ToolChainDetector.ts](./src/detectors/ToolChainDetector.ts)
- 检查：
  - 同工具连续调用过长
  - 工具调用形成循环模式
- 豁免：
  - 输入显著不同
  - 合理批处理
  - 收敛式搜索

### 5. Dead Step

- 实现：
  - [src/detectors/DeadStepDetector.ts](./src/detectors/DeadStepDetector.ts)
  - [src/analyzers/ContextChainAnalyzer.ts](./src/analyzers/ContextChainAnalyzer.ts)
- 检查：
  - 工具结果是否进入后续工具输入
  - 是否进入 assistant 文本计划
  - 是否触达相关文件或相关符号
  - 是否引发分支变化
- 当前特别规则：
  - `Write` 不会被判定为 `deadStep`
- 说明：
  - 当前“后续引用”优先限定在真实后代消息范围内，避免被无关分支的晚到消息误判为已消费。

### 6. Duplicate Step

- 实现：
  - [src/detectors/DuplicateStepDetector.ts](./src/detectors/DuplicateStepDetector.ts)
- 检查：
  - 输入结构相似
  - 中间没有相关文件变更
  - 输出高度相似
  - AST 符号集合高度重合

### 7. Wrapper Workflow

- 实现：
  - [src/detectors/WrapperDetector.ts](./src/detectors/WrapperDetector.ts)
- 检查：
  - Agent 内部步骤极少
  - 下游工具类型单一
  - 输入输出相似
  - 无验证
  - 符号增量很低

### 8. Context Coupling

- 实现：
  - [src/detectors/CouplingDetector.ts](./src/detectors/CouplingDetector.ts)
- 检查：
  - 调用图 SCC
  - 交替调用模式
  - 回边
  - 代码邻域之间反复回流

### 9. Long Chain

- 实现：
  - [src/detectors/LongChainDetector.ts](./src/detectors/LongChainDetector.ts)
- 检查：
  - 显式子任务
  - 显式检查点
  - 隐式代码簇切换
  - 隐式验证性回读

### 10. Interface Inconsistency

- 实现：
  - [src/detectors/InterfaceConsistencyDetector.ts](./src/detectors/InterfaceConsistencyDetector.ts)
- 检查：
  - 参数名集合差异
  - 参数类型差异
  - 返回结果形态差异
  - 返回符号类型分布差异
  - 在相近代码邻域上的接口风险

### 11. Weak Tool

- 实现：
  - [src/detectors/WeakToolDetector.ts](./src/detectors/WeakToolDetector.ts)
- 检查：
  - 适用任务数
  - 实际调用数
  - 替代工具覆盖
  - 项目 AST / 文件关系增强后的适用场景识别

## AST 与项目关系

### AST

- [src/analyzers/AstAnalyzer.ts](./src/analyzers/AstAnalyzer.ts)
- 基于 tree-sitter
- 支持多语言
- 抽取：
  - classes
  - functions
  - methods
  - properties
  - variables
  - calls

### 项目级关系

- [src/analyzers/ProjectAstLoader.ts](./src/analyzers/ProjectAstLoader.ts)
- [src/analyzers/FileAssociationLoader.ts](./src/analyzers/FileAssociationLoader.ts)

输入来源：

- 项目代码解析结果
- 外部 related files 数据

输出用途：

- 间接文件引用
- 符号所有权
- 代码邻域扩展
- 模块簇切换识别

## 当前统计口径

### 单份报告

单份报告输出：

- 总告警数
- 总错误数
- 每维度告警数 / 错误数
- 关键问题
- 优势

### 多份报告

[src/benchmark/BenchmarkRunner.ts](./src/benchmark/BenchmarkRunner.ts) 当前聚合：

- 每维度平均告警数
- 每维度平均错误数
- 95% CI

不再聚合：

- 总分
- 评级
- 维度分数
