# 11项评测基准方法论（过程风险增强版）

面向 Ghost/Wrapper/Oversized/Thrashing/ToolChain/Coupling/Interface/Weak/Dead/Duplicate/Long 11项基准，结合：
- AST（tree-sitter，JS/TS优先）→ 类/函数/方法/导入等符号级引用
- 文件关联图谱（外部脚本生成）→ 核心关联文件集合 A(f)
- 轨迹事件（messages/toolUses/toolResults/replacements/usage）→ 可复验证据
- finding 标准化 → detector score / posterior risk / risk severity
- 控制保持分析 → interpretability / interruptibility / corrigibility / reversibility / handoff awareness
- 执行引导 → summarize-context / checkpoint / verify / confirmation / handoff

通用变量：
- F：文件集合；A(f)：f 的核心关联文件集合；Sym(f)：f 的符号集合
- τ：执行轨迹；U_t：上下文使用token；W：窗口大小；Δ_t：某步载荷
- 引用判定 Ref(x→y)：x 的符号（或文件）在 y 的输入/计划/文件操作中出现，或 A(x) 与 y 操作目标相交

## 1. Ghost Context
- 现象：摘要替换后原文仍保留 ≥L 步；或不可消费payload（base64/二进制/超长单行）≥T。
- 度量：G = Σ(|orig|-|summary|)_+ / Σ|context|
- 证据：replacements + token估计 + Ref(原文→后续k步)缺失
- 判定：G≥g_warn（Warning），G≥g_err（Error）；窗口预警阈值 0.75（提前压缩）

## 2. Wrapper Workflow
- 现象：Agent透传输入给单一工具类型，不做约束/聚合/校验/改写。
- 度量：wrapper率 = 满足 {内部≤1步，工具类型单一，高输入/输出相似，无验证} 的调用比例
- 证据：AST无新增符号；下游与上游符号重合度高（Jaccard≥0.8），且工具类型唯一

## 3. Oversized Rules
- 现象：system规则过大或占比过高。
- 度量：Rs（system tokens），r=Rs/total；是否最大静态块
- 判定：双阈值；附带“最大静态内容”证据

## 4. Context Thrashing
- 现象：载入后短步内压缩。
- 度量：Θ=Δ_t/(W-U_{t^-})；look-ahead=2
- 分类：timing fault（临近阈值仍晚压缩）；oversize fault（单载荷过大）。
- 建议：AST+图谱评估文件大小→提前摘要；或先 repomix 后再读

## 5. Tool Call Chain
- 现象：同名工具连续过多；或循环模式 A→B→A→...
- 度量：C（连续计数），(p,q)（模式长度/重复轮数），序列熵 H_seq
- 证据：临近阈值时注入预警消息；对批处理/多样输入/收敛搜索豁免

## 6. Context Coupling
- 现象：非层次化交错依赖；SCC/交替模式/回边。
- 度量：C_scc=Σ(|SCC|-1)/|V|
- 证据：调用图 + 事件时序；给出耦合类型与次数

## 7. Interface Inconsistency
- 现象：功能相似工具接口差异；多次试验使用分散。
- 度量：D（Jaccard+类型不一致率）；分散度 Ĥ（归一化熵）
- 证据：试验组间显著性（Bootstrap/配对t检）

## 8. Weak Tool
- 现象：适用场景中调用率低；替代工具被大量使用。
- 度量：α=A/S；替代比率；变异增强实验前后差异显著性

## 9. Dead Step
- 现象：结果未被后续引用或影响决策。
- AST增强：解析结果中的符号集 Sym(result)，在后续k步输入/计划/文件操作/分支变化中查 Ref；若文件级无交集但 A(f)∩目标≠∅ 也算间接引用。
- 证据：失败数 f≥3（Warning），f=4（Error）；提供符号与文件证据切片

## 10. Duplicate Step
- 现象：同工具、输入/结果高度相似、期间状态未变。
- AST增强：比较输入结构与结果符号重合度，确认语义重复；若 A(f) 在期间无任何写入，判定重复更强。

## 11. Long Chain
- 现象：执行链过长，缺子任务/检查点。
- 度量：L_eff = L / (1+N_sub+N_ckpt)；无子任务时用简单阈值
- 证据：记录多次压缩与失败率的相关性，支持因果提示（链过长→失败率升高）

## 统计与复验
- 多次试验（≥5/任务）：输出均值±95% CI；配对检验与效应量报告。
- 复验材料：随机种子、版本戳、依赖哈希、轨迹快照。

## 风险与控制保持

- detector 先输出 issue，再标准化为 finding。
- finding 至少包含：`metric`、`dimension`、`detectorScore`、`posteriorRisk`、`riskSeverity`、`conditionSignals`。
- 当前仓库实现的 `posteriorRisk` 是 `heuristic-bayesian-proxy`：
  - 使用缺陷类型经验先验
  - 结合 detector 严重度、证据强度和 detector score
  - 输出更稳定的 warning / error 风险语义
- `controlPreservation` 不与 issue 数量直接等价，而是作为独立维度补充：
  - `interpretability`
  - `interruptibility`
  - `corrigibility`
  - `reversibility`
  - `handoffAwareness`
- `executionGuidance` 使用 `overallRisk` 与 `controlPreservation.score` 共同决定自治调节强度。

## 实施与集成
- AST：`src/analyzers/AstAnalyzer.ts`（tree-sitter，退化正则）
- 文件图谱：`src/analyzers/FileAssociationLoader.ts`（读取外部JSON）
- 聚合：`src/benchmark/BenchmarkRunner.ts`（Bootstrap CI）
- 生成图谱命令（示例）：
  `npx tsx '~/Desktop/ACoder/scripts/analyze-files.ts' ~/Desktop/ACoder/scripts/analyze-files-example.json`
- 建议把生成的 JSON 存到 `output/file-graph.json` 并在评测配置中声明路径。
