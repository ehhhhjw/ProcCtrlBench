# Claude Code Runtime Guard 方案

本文给出一个独立于当前评测主流程之外的运行时组件方案。目标不是在任务结束后再做离线评估，而是直接在 Claude Code CLI 执行过程中，基于增量 `jsonl` transcript、项目 AST、related-files 图谱，对 11 个基准做实时监控、预警和过程内纠偏。

## 1. 设计目标

- 独立部署：
  - 不侵入当前 `src/` 主评测逻辑
  - 作为 sidecar / wrapper 组件单独启停
- 一键嵌入：
  - 通过 Claude Code hooks + transcript tailing 接入
  - 不要求修改 Claude Code 内部源码
- 可配置：
  - 11 个基准逐项开关
  - 每项基准独立策略、阈值、动作等级
- 低耦合：
  - AST、related files、运行轨迹分别解耦
  - 允许只开轨迹规则，不强制依赖全量项目分析
- 可控干预：
  - 支持只观察、告警、阻断前提示、自动注入修正建议四种模式

## 2. 组件形态

推荐把该组件实现为独立目录，例如：

```text
claude-code-runtime-guard/
  bin/
    cc-guard
  config/
    guard.config.json
  runtime/
    transcript-watcher.ts
    hook-adapter.ts
    guard-engine.ts
    remediation-engine.ts
  analyzers/
    benchmark-specific analyzers
  cache/
    session-state
  output/
    alerts
    traces
```

在当前仓库中，可先用文档与配置模板定义组件边界，后续独立抽出成单独仓库或 npm 包。

## 3. Claude Code CLI 接入方式

Claude Code 本身具备适合接入该组件的两个关键事实：

- transcript 是增量 append 的 `jsonl`
- hooks payload 中可以拿到 `session_id`、`transcript_path`、`cwd`

因此推荐采用“双通道接入”：

### 3.1 通道 A：hooks 低延迟拦截

用于在关键动作发生前后触发守护逻辑：

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse`
- `PostToolUse`
- `SubagentStart`
- `SubagentStop`
- `PreCompact`
- `Stop`

hooks 的作用不是重建全量历史，而是：

- 给守护进程发送“当前正在发生什么”的高时效事件
- 在 `PreToolUse` 阶段执行“阻断前检查”
- 在 `PreCompact` 阶段做上下文质量评估

### 3.2 通道 B：transcript tailing 真相回放

hooks 的信息不完整，最终仍要以 transcript 为准。sidecar 持续 tail `jsonl`：

- 读取最新追加事件
- 增量构建会话状态
- 与 hooks 事件做对账
- 做跨步检测、窗口检测、周期检测

这能解决两个问题：

- hooks 只能看到当前动作，看不到完整链路
- Claude Code 运行时上下文不是 transcript 的简单等价物，需要从事件流重建“有效上下文近似”

## 4. 守护组件内部架构

```text
Claude Code CLI
  -> Hook Adapter
  -> Runtime Guard Sidecar
       -> Transcript Watcher
       -> Session State Store
       -> AST Context Provider
       -> Related Files Provider
       -> 11 Benchmark Analyzers
       -> Remediation Engine
       -> Action Dispatcher
```

### 4.1 Transcript Watcher

职责：

- 监听主 transcript 与 subagent transcript
- 按 offset 增量读取新行
- 解析事件并标准化为内部 event stream

### 4.2 Session State Store

维护运行时需要的最小状态：

- 最近 N 步消息
- 当前工具调用链
- 已读文件、已写文件、已改符号
- 当前任务簇 / 子任务簇
- 最近压缩边界
- 当前候选上下文集合
- 最近一次预警与抑制窗口

### 4.3 AST Context Provider

输入：

- 项目 AST
- 当前活跃文件
- 当前工具参数中的路径、符号、行号

输出：

- 文件邻域
- related symbols
- 读写覆盖范围
- 调用点 / 定义点关系

### 4.4 Related Files Provider

把外部 related files 结果并入代码邻域判断。它的角色不是替代 AST，而是补 AST 中难以静态恢复的实现链路。

### 4.5 Remediation Engine

不直接改 Claude Code 内部上下文，而是输出可消费的纠偏动作：

- 控制台提示
- hook stderr 告警
- 生成 sidecar 建议文件
- 通过用户消息注入器注入下一轮提示
- 在 `PreToolUse` 阶段返回阻断意见

## 5. 干预等级

建议统一为四级：

- `observe`
  - 只记录，不提示
- `warn`
  - 输出告警，不阻断
- `guard`
  - 在高风险步骤前给出建议，并要求确认
- `remediate`
  - 自动生成修复性提示或替代执行建议

## 6. 11 个基准的运行时解决方案

下面按“检测时机 + 缺陷信号 + 过程内动作”设计。

## 6.1 Ghost Context

### 检测时机

- `PostToolUse`
- `PreCompact`
- transcript 中出现大 payload / replacement / summary 后

### 缺陷信号

- 大段内容被引入后 3 到 5 步内无消费
- 摘要与原文共存过久
- base64 / 大 JSON / 长日志未被结构化提炼
- 大段代码读入后没有继续触达相关符号或相关文件

### 过程内动作

- `warn`：
  - 提示“当前大内容尚未被消费，建议先摘要再继续”
- `guard`：
  - 在下次读大文件前提示“先使用 Grep / symbol search 缩小范围”
- `remediate`：
  - 自动注入一条修正建议：
    - “请先总结上一段载荷的有效结论，仅保留与目标文件/符号直接相关的信息”

### 规避目标

- 减少无效大上下文滞留
- 降低后续 compact 的质量损失

## 6.2 Oversized Rules

### 检测时机

- `SessionStart`
- 首轮 assistant 输出前
- `PreCompact`

### 缺陷信号

- system / appended rules 绝对体积过大
- 规则占当前上下文比重过高
- 规则已经成为最大静态块

### 过程内动作

- `warn`：
  - 报告规则 token 占比
- `guard`：
  - 提示切换为“最小规则 + 外部文档引用”
- `remediate`：
  - 自动生成压缩版 rule 摘要文件
  - 将长规则转为引用提示，而非重复注入全文

### 规避目标

- 避免规则挤占执行态上下文

## 6.3 Context Thrashing

### 检测时机

- `PreToolUse` 读大文件前
- `PreCompact`
- transcript 发现短期内大量读入后又压缩

### 缺陷信号

- 窗口已接近阈值还继续读大对象
- 1 到 2 步后就发生 compact / replacement
- 压缩前引入的信息没有继续用到

### 过程内动作

- `warn`：
  - 报告“即将读入的大对象很可能马上被压缩”
- `guard`：
  - 拦截 `Read` / `Glob` / 大日志读取，要求先缩小范围
- `remediate`：
  - 自动建议替代策略：
    - 先 Grep / symbol search
    - 只读命中段
    - 先摘要上文，再扩展新对象

### 规避目标

- 避免“读了就丢”

## 6.4 Tool Call Chain

### 检测时机

- 每次 `PostToolUse`

### 缺陷信号

- 同工具连续调用过长
- 出现 A->B->A / A->B->A->B 循环
- 输入差异很小，且没有代码邻域推进

### 过程内动作

- `warn`：
  - 提示“连续工具链过长，建议合并批处理”
- `guard`：
  - 当达到错误阈值时阻断下一次同类工具调用
- `remediate`：
  - 生成替代计划：
    - 批量 grep 后集中 read
    - 先定位目标符号再操作
    - 从搜索转为验证

### 规避目标

- 避免低效空转链

## 6.5 Dead Step

### 检测时机

- 某次工具成功返回后，向后观察 3 到 5 步

### 缺陷信号

- 工具结果未被后续输入引用
- 未进入后续计划文本
- 未引起文件/符号/related-files 邻域动作
- 未产生分支变化
- `Write` 永不判为 dead step

### 过程内动作

- `warn`：
  - 对刚完成但尚未消费的结果打标
- `guard`：
  - 在连续出现 dead step 候选时，阻止继续同类盲读
- `remediate`：
  - 自动提示：
    - “请先说明上一工具结果对当前问题的影响，再决定下一步”

### 规避目标

- 强制每个读取 / 搜索结果进入后续决策链

## 6.6 Duplicate Step

### 检测时机

- 新工具调用前比对最近同类步骤

### 缺陷信号

- 输入高度相似
- 中间没有相关文件变更
- 输出摘要高度相似
- 命中同一 AST 符号集合

### 过程内动作

- `warn`：
  - 标记为“重复操作候选”
- `guard`：
  - 二次重复时要求解释重复原因
- `remediate`：
  - 自动给出更优动作：
    - 使用缓存结果
    - 直接进入修改 / 验证
    - 扩大目标范围而不是重复读同一点

### 规避目标

- 降低重复读取、重复搜索、重复执行

## 6.7 Wrapper Workflow

### 检测时机

- subagent / agent 工具完成后
- `SubagentStop`

### 缺陷信号

- agent 只做简单透传
- 下游工具类型单一
- 输入输出高度相似
- 没有变换、验证、聚合
- 低符号增量

### 过程内动作

- `warn`：
  - 报告“当前 agent 更像包装层”
- `guard`：
  - 限制继续为该模式派生新 subagent
- `remediate`：
  - 提示把简单包装逻辑折叠回主线程
  - 或要求 agent 负责明确子任务边界与验证标准

### 规避目标

- 避免空壳 agent 增加调用层级

## 6.8 Context Coupling

### 检测时机

- 每轮消息后更新调用图
- `SubagentStop`

### 缺陷信号

- 主线程和多个 subagent 在同一代码邻域高频来回切换
- 调用图出现强 SCC
- 回边频繁
- 上下文在多个 worker 间来回搬运

### 过程内动作

- `warn`：
  - 提示“当前任务簇耦合过高，建议拆分边界”
- `guard`：
  - 在新建 subagent 前评估是否与现有 worker 写集冲突
- `remediate`：
  - 自动建议：
    - 以文件簇拆分
    - 以符号所有权拆分
    - 先完成局部闭环再切换线程

### 规避目标

- 控制主线程与分支线程的上下文回流

## 6.9 Long Chain

### 检测时机

- 每轮结束后评估当前任务链长度

### 缺陷信号

- 步数过长
- 没有显式 checkpoint
- 没有显式子任务闭环
- 同一问题跨过多文件簇来回游走

### 过程内动作

- `warn`：
  - 提醒建立 checkpoint
- `guard`：
  - 到达阈值时要求先总结，再继续
- `remediate`：
  - 自动注入：
    - 当前已完成项
    - 未完成项
    - 下一步只允许聚焦一个子问题

### 规避目标

- 防止无界探索链

## 6.10 Inconsistent Tool Interface

### 检测时机

- `SessionStart`
- 首次工具注册完成后
- 新工具第一次被调用时

### 缺陷信号

- 语义相近工具接口不一致
- 参数命名、结果形态差异过大
- 同类读写工具返回结构不统一

### 过程内动作

- `warn`：
  - 输出接口风险摘要
- `guard`：
  - 在高风险工具切换时要求显式参数映射
- `remediate`：
  - 生成 canonical adapter 层：
    - 统一 path 字段
    - 统一 result schema
    - 统一 success/error envelope

### 规避目标

- 降低模型因工具接口不一致产生的误用

## 6.11 Weak Tool

### 检测时机

- `SessionStart`
- 每轮任务簇切换后

### 缺陷信号

- 明明存在更适用工具却长期不用
- 读大文件替代搜索工具
- 手工遍历替代 AST / grep / structured tool

### 过程内动作

- `warn`：
  - 提示“存在更强工具候选”
- `guard`：
  - 在低效替代模式持续出现时阻止继续弱工具路径
- `remediate`：
  - 自动建议最适合的替代工具
  - 给出调用模板

### 规避目标

- 把工具选择从“能用”提升到“适配度更高”

## 7. 配置文件设计

核心要求：

- 全局模式统一控制
- 11 项基准可单独开关
- 每项都可配置阈值、动作等级、冷却窗口

建议配置项：

- `enabled`
- `mode`
- `thresholds`
- `actions`
- `cooldownSteps`
- `injectPrompt`
- `blockOnError`

具体模板见：

- [tools/claude-code-runtime-guard/guard.config.example.json](./tools/claude-code-runtime-guard/guard.config.example.json)

## 8. 一键嵌入方式

当前仓库里已经提供可直接使用的接入脚本：

- [bin/claude-with-guard](./tools/claude-code-runtime-guard/bin/claude-with-guard)
- [bin/cc-guard-hook](./tools/claude-code-runtime-guard/bin/cc-guard-hook)

推荐先安装 hooks：

```bash
./tools/claude-code-runtime-guard/bin/claude-with-guard \
  --config ./tools/claude-code-runtime-guard/guard.config.example.json \
  --install-only
```

这会把 hooks 合并写入当前项目的 `.claude/settings.local.json`，并把传入的 guard 配置文件同步复制到当前项目的 `.claude/` 目录中。后续 hook 会优先读取项目内这份配置副本，避免并发项目共享同一个配置文件。

之后直接用：

```bash
./tools/claude-code-runtime-guard/bin/claude-with-guard \
  --config ./tools/claude-code-runtime-guard/guard.config.example.json
```

执行流程：

1. wrapper 复制 guard 配置到目标项目 `.claude/` 目录，并合并写入 Claude hooks 配置
2. Claude Code CLI 正常启动
3. Claude 在 `SessionStart` / `PreToolUse` / `PostToolUse` / `PreCompact` 等事件触发 hook
4. hook 把 payload 传给 `cc-guard-hook`
5. `cc-guard-hook` 调用 runtime guard engine
6. engine 读取 transcript 并运行 11 个基准
7. hook 返回：
   - `systemMessage`
   - `hookSpecificOutput.additionalContext`
   - `permissionDecision=deny`（高风险 PreToolUse）

## 9. 最小可行实现顺序

建议分三期：

### Phase 1

- transcript tailing
- SessionStart / PreToolUse / PostToolUse / PreCompact hooks
- 先落地 5 项高收益基准：
  - Ghost Context
  - Context Thrashing
  - Tool Call Chain
  - Dead Step
  - Duplicate Step

### Phase 2

- subagent 关系
- Context Coupling
- Wrapper Workflow
- Long Chain

### Phase 3

- 工具接口建模
- Inconsistent Tool Interface
- Weak Tool
- 自动 remediation 注入

## 10. 推荐输出

sidecar 建议输出三类产物：

- `alerts/<session_id>.jsonl`
  - 逐条告警
- `state/<session_id>.json`
  - 当前守护状态
- `remediation/<session_id>.md`
  - 可注入的修正建议

## 11. 结论

对 Claude Code CLI，最稳妥的落地方式不是改内部源码，而是：

- 用 hooks 拿“当前时刻”
- 用 transcript tailing 拿“全局历史”
- 用 AST + related files 补“代码语义邻域”
- 用 11 个基准驱动实时告警与轻量干预

这样得到的是一个真正独立、可一键接入、可逐项开关、可持续演进的运行时缺陷防护组件。
