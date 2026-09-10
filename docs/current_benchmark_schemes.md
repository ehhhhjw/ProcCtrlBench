# 当前 11 个基准评估方案

本文整理当前仓库里实际落地的 11 个评测基准方案，统一说明：
- 评估所依赖的数据基础
- 每个基准的检测信号与判定逻辑
- 当前阈值与扣分方式
- 误报控制
- 建议整改方向

本文以当前实现为准，相关代码主要位于 `src/detectors/`、`src/analyzers/`、`src/config/evaluation.config.ts`。

## 一、统一数据基础

### 1. 轨迹数据
- 来源：`SessionData`
- 主要字段：
  - `messages`
  - `toolUses`
  - `toolResults`
  - `agents`
  - `replacements`
- 用途：恢复执行链、上下文变化、工具调用顺序、文件读写、Agent 分支与压缩行为。

### 2. 文件关联图谱
- 产物：`output/file-graph.json`
- 作用：判断文件的间接关联、间接变更、间接引用。
- 加载器：`src/analyzers/FileAssociationLoader.ts`

### 3. 项目级 AST 分析
- 产物：`output/project-ast.json`
- 构建脚本：`scripts/build-file-graph.ts`
- 配置文件：`config/project-analysis.config.json`
- 可配置项：
  - `projectPath`：待分析项目路径
  - `relatedFilesDataPath`：外部 related-files 数据路径
- AST 能力：
  - 基于 tree-sitter 的多语言全量解析
  - 当前支持：TypeScript、TSX、JavaScript、Python、Java、C++、C#
  - 细粒度提取：
    - 类
    - 函数
    - 方法
    - 属性
    - 变量
    - 调用点
    - 文件关系
    - 符号所有权
    - 代码邻域
- 相关代码：
  - `src/analyzers/AstAnalyzer.ts`
  - `src/analyzers/ProjectAstLoader.ts`

### 4. 外部 related files 数据
- 来源：用户提供的外部结果目录
- 合并方式：在项目 AST 分析阶段并入 `project-ast.json`
- 当前关系类型：`external_related`
- 作用：把文件实现链路上的相关文件一起纳入基础评测上下文

### 5. 阈值与预警
- 阈值配置：`src/config/evaluation.config.ts`
- 预警输出：`output/prewarn.json`
- 用途：在正式命中 Warning/Error 前，对接近阈值的行为提前提示

---

## 二、11 个基准的当前方案

## 1. Ghost Context

### 目标
- 检测上下文中残留但后续无实质作用的大段内容，尤其是摘要后仍保留的原文、不可消费 payload、超长噪声内容。

### 当前信号
- `content-replacement` 之后原文与摘要共存
- base64 / 二进制 / 超长单行等不可消费内容
- 后续 5 步内是否被文本或工具输入引用
- 后续步骤是否继续触达相同代码符号、同一文件邻域或 related files

### 判定逻辑
- 如果一段大内容在摘要或替换后仍长时间保留，且没有被后续步骤有效引用，则视为幽灵上下文
- 如果载荷本身为不可消费噪声，也计入浪费
- 对代码类内容，不再只看关键词引用；若后续步骤继续作用于相同代码邻域，则不轻易判定为 ghost

### 当前阈值
- Warning：`512` tokens
- Error：`1024` tokens

### 扣分
- Warning：`0.5`
- Error：`1.5`

### 误报控制
- 摘要后若仍有后续引用，不判浪费
- 短暂共存的小片段不计入

### 整改方向
- 摘要后及时移除原文
- 对大对象先摘要，再外链或落盘

---

## 2. Oversized Rules

### 目标
- 检测 system/rules 规则块过大、占比过高，长期挤压有效上下文窗口。

### 当前信号
- `system` 内容 token 数
- `system` 在累计上下文中的占比
- 是否为最大的静态上下文块

### 判定逻辑
- 当规则体积或占比超过阈值时触发
- 同时考虑绝对大小和相对占比

### 当前阈值
- token Warning / Error：`2000 / 4000`
- ratio Warning / Error：`0.20 / 0.35`

### 扣分
- Warning：`0.5`
- Error：`1.5`

### 误报控制
- 与其他静态块对比，避免误把较小但出现较早的 system 误判成过大

### 整改方向
- 精简规则
- 长文档外链
- 规则按需加载

---

## 3. Context Thrashing

### 目标
- 检测接近窗口上限时读取大对象，随后又快速发生压缩，导致新引入信息没有被有效消费。

### 当前信号
- `context_tokens_before`
- `context_tokens_after`
- 是否在接近窗口阈值后很快出现压缩
- 压缩前读入的数据是否被后续使用
- 压缩前是否已经在同一代码邻域继续执行

### 判定逻辑
- 当窗口占用达到高位后，又在很短步数内发生 replacement 或 token 显著回落，视为抖动
- 区分两类：
  - `timing_fault`
  - `payload_oversize_fault`
- 若压缩前已经在相同文件/符号/related-files 邻域中继续执行，则不把该载荷视为“未被利用”

### 当前阈值
- `windowThreshold = 0.75`
- `compressionLookAhead = 2`

### 扣分
- Warning：`1.0`

### 误报控制
- 多步平缓下降不算压缩抖动
- 纯输出波动不算

### 整改方向
- 先压缩再读
- 大对象分批读
- 先摘要再展开

---

## 4. Tool Call Chain

### 目标
- 检测相同工具的过长连续调用，或 A→B→A 一类循环调用。

### 当前信号
- 同名工具连续段长度
- 短周期循环模式
- 输入是否足够多样
- 是否在同一代码邻域内做渐进式批处理或收敛式搜索

### 判定逻辑
- 连续调用过长视为重复链
- 短周期重复模式视为循环链
- 但如果调用序列在 related-files 邻域内持续推进、或搜索模式在收敛，则作为豁免信号

### 当前阈值
- repetitive Warning / Error：`6 / 10`
- cyclic Warning / Error：`3 / 5`

### 扣分
- Warning：`1.0`
- Error：`2.5`

### 误报控制
- 批处理场景做豁免
- 输入多样性高的搜索/扫描不判空转

### 整改方向
- 合并批量操作
- 提升检索粒度
- 循环时及时切换策略

---

## 5. Dead Step

### 目标
- 检测某一步工具结果没有被后续流程有效引用、也没有对执行分支产生影响。

### 当前数据基础
- 轨迹数据
- 文件关联图谱
- 项目 AST
- 外部 related files

### 当前信号
- 文本关键词是否在后续输入/计划中出现
- AST 符号是否在后续步骤中出现
- 文件或相关文件是否被后续读/写
- 是否引起后续 Agent 分支变化

### 判定逻辑
- 对每个成功工具结果做四类检查：
  - `noToolInputRef`
  - `noPlanRef`
  - `noFileRef`
  - `noBranchImpact`
- 失败检查数：
  - `4/4`：Error
  - `3/4`：Warning

### 扣分
- Warning：`0.5`
- Error：`1.0`

### 误报控制
- 优先识别间接文件引用
- 优先识别符号级引用
- `is_error` 结果跳过

### 整改方向
- 移除无用步骤
- 或让后续步骤显式消费该结果

---

## 6. Duplicate Step

### 目标
- 检测对同一资源的重复操作，且两次之间没有发生足够的状态变化。

### 当前数据基础
- 轨迹数据
- 文件变更时间
- 文件关联图谱
- 项目 AST

### 当前信号
- 两次工具输入结构相似度
- 两次结果文本相似度
- AST 符号集合 Jaccard 重合度
- 相关文件在两次之间是否变更

### 判定逻辑
- 满足以下条件之一时判重复：
  - 输入高相似 + 文件未变 + 结果高相似
  - 输入高相似 + 文件未变 + 符号集合高度重合
- 同时豁免天然时变或验证性命令

### 当前阈值
- 输入结构相似度：`> 0.9`
- 结果相似度：`> 0.9`
- 符号 Jaccard：`> 0.8`

### 扣分
- Warning：`0.5`
- Error：`1.5`

### 误报控制
- `git status`、`date` 一类时变命令豁免
- `npm test`、`pytest` 一类验证命令豁免

### 整改方向
- 缓存或复用已有结果
- 对验证步骤增加去重逻辑

---

## 7. Wrapper Workflow

### 目标
- 检测 Agent 是否只是把输入透传给下游工具，没有提供真正的编排价值。

### 当前数据基础
- Agent/sidechain 轨迹
- AST 符号抽取
- 项目 AST 邻域

### 当前信号
- 内部步骤数是否极少
- 下游工具类型是否单一
- Agent 输入与下游输入是否高度相似
- Agent 输出与下游输出是否高度相似
- 是否缺少验证逻辑
- 代码作用域是否过窄
- 新增符号占比是否很低

### 判定逻辑
- 以多项条件的满足比例衡量包装程度
- 统计某个 Agent 在多次调用中的 wrapper rate
- 仅对调用次数 `>= 5` 的 Agent 进行判断

### 当前阈值
- 预警：`>= 75%`
- Warning：`>= 80%`
- Error：`>= 95%`

### 扣分
- Warning：`1.0`
- Error：`2.0`

### 误报控制
- 少量调用不统计
- 存在验证、聚合或较宽代码覆盖时不轻易判 wrapper

### 整改方向
- 增加验证、转换、聚合
- 没有额外价值时直接下沉调用

---

## 8. Context Coupling

### 目标
- 检测工作流是否存在循环依赖、交替调用或回边，导致上下文结构耦合严重。

### 当前信号
- Tarjan SCC
- DFS 回边
- A-B-A-B 交替模式
- 代码邻域序列上的 SCC、回边和交替模式

### 判定逻辑
- 非 DAG 结构视为耦合风险
- 小 SCC 可先预警，大量交替或回边则直接告警
- 除 Agent/调用图外，还额外检查“代码上下文图”是否在多个模块簇间来回回流

### 扣分
- Warning：`1.0`

### 误报控制
- 合理的小范围协同不做过度惩罚

### 整改方向
- 重构为单向数据流
- 在阶段边界落盘/隔离上下文

---

## 9. Long Chain

### 目标
- 检测执行链过长，且没有足够的任务拆分或检查点。

### 当前数据基础
- 轨迹数据
- 项目 AST
- 文件邻域与符号集合

### 当前信号
- 总步骤数
- 显式子任务数量
- 显式检查点数量
- 结构化子任务
- 结构化检查点

### 判定逻辑
- 有效链长：
  - `Leff = L / (1 + Nsub + Nckpt)`
- 子任务包含两类：
  - 显式子任务：Agent / sidechain
  - 隐式子任务：代码关注点切换到新的模块簇
- 检查点包含两类：
  - 显式检查点：用户消息、明确测试步骤
  - 隐式检查点：修改后对同一代码簇做验证/回读

### 当前阈值
- effective length Warning / Error：`12 / 20`
- simple Warning / Error：`25 / 40`

### 扣分
- Warning：`1.0`
- Error：`2.5`

### 误报控制
- 通过项目 AST 识别隐式阶段切分，避免把实际已分阶段的执行链误判成长链

### 整改方向
- 引入子任务
- 在关键修改后加入验证
- 用阶段性 checkpoint 切分链路

---

## 10. Interface Inconsistency

### 目标
- 检测功能相近工具在输入/输出结构上不一致，或使用边界不清晰。

### 当前数据基础
- 工具调用输入
- 工具结果内容
- AST 结果形态
- 项目 AST 代码邻域

### 当前信号
- 参数名集合差异
- 参数类型差异
- 结果形态差异：
  - `text`
  - `json_like`
  - `json_text`
  - `code_like`
  - `path_like`
- 返回符号类型分布差异
- 同组工具作用的文件邻域重合度
- 工具使用分散度

### 判定逻辑
- 对工具簇做两类分析：
  - schema difference
  - semantic overlap
- 当语义重合度高，但 schema 差异也高时，风险更大
- 对分散度也做语义修正：
  - 如果项目 AST 显示这些工具其实作用于同一代码区域，则高分散度更可能是接口设计不清
  - 如果没有项目 AST，则退回原始统计口径

### 当前阈值
- interface risk Warning / Error：`> 0.4 / > 0.7`
- dispersion Warning：`> 0.8`

### 扣分
- Warning：`1.0`
- Error：`2.0`

### 误报控制
- 无项目 AST 时，不用新增语义因子破坏原有基线
- 不同代码域的天然分工，尽量不误判成接口不一致

### 整改方向
- 统一参数命名
- 统一结果结构
- 明确工具边界

---

## 11. Weak Tool

### 目标
- 检测某些工具在本应适用的场景中调用率偏低，说明可发现性差或被替代。

### 当前信号
- 推断任务类型
- 适用任务总数
- 实际调用数
- 替代工具调用情况
- 工具触达的文件邻域、符号数量与 related-files 覆盖范围

### 判定逻辑
- 先根据工具使用模式推断任务类型：
  - 文件搜索
  - 代码搜索
  - 文件读取
  - 文件修改
  - 命令执行
  - 子任务委派
  - web 搜索 / 获取
- 对每个工具计算：
  - `callRate = actualCallCount / suitableTaskCount`
- 任务机会不再只由工具名反推；多文件相关修改、跨邻域操作、符号密集结果也会增加相应工具的“应被调用机会”

### 当前阈值
- Warning：`callRate < 0.30`
- Error：`callRate < 0.15`
- 接近阈值预警：`0.30 - 0.35`

### 扣分
- Warning：`1.0`
- Error：`2.0`

### 误报控制
- 仅在适用任务数足够多时统计
- 同时看是否被替代工具大幅覆盖

### 整改方向
- 改进工具描述
- 增加示例
- 在适用场景中主动提示工具使用

---

## 三、当前 11 个基准与 AST 的关系

### 强依赖 AST / 项目关系的基准
- Dead Step
- Duplicate Step
- Wrapper Workflow
- Long Chain
- Interface Inconsistency

### 主要依赖行为统计或上下文统计的基准
- Ghost Context
- Oversized Rules
- Context Thrashing
- Tool Call Chain
- Context Coupling
- Weak Tool

Context Chain 增强：
- 当前实现已引入 [ContextChainAnalyzer](./src/analyzers/ContextChainAnalyzer.ts)，直接基于 `parentUuid` 恢复每个 step 的真实上下文链。
- `Ghost Context`、`Dead Step`、`Context Thrashing` 不再只依赖“按时间向后看 N 步”或“累计所有历史 token”的粗粒度近似，而是优先使用真实祖先链 / 后代链判断上下文占用与复用。
- 这会降低分支切换、 sibling message、无关后续 chatter 对基准结果的干扰。

说明：
- 不是所有基准都需要强行接入 AST。
- 当前策略是：只有当 AST 能显著提升“是否真正发生代码关联、符号关联、模块切换、代码邻域一致性”的判断质量时，才接入 AST。

---

## 四、当前配置与输出入口

### 配置文件
- [config/project-analysis.config.json](./config/project-analysis.config.json)

### 关键输出
- [file-graph.json](./output/file-graph.json)
- [project-ast.json](./output/project-ast.json)
- [prewarn.json](./output/prewarn.json)

### 相关文档
- [benchmark_specs.md](./docs/benchmark_specs.md)
- [benchmark_evaluation_guide.md](./docs/benchmark_evaluation_guide.md)

---

## 五、建议的后续补强

- 给 `WeakTool` 接入项目 AST，把“适用任务”的判定从纯工具模式推断提升到代码关系机会识别。
- 补充每个 detector 的样例输入/样例 issue 输出，形成可直接复验的 benchmark case 文档。
- 给 11 个基准增加“基础版 / AST 增强版”的信号对照表，方便做版本说明。
