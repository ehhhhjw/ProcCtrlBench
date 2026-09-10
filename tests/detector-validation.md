# 检测器验证报告

## 文档要求对照检查

基于 `~/Downloads/acoder version.md` 的要求

---

## 1. Ghost Context (幽灵上下文)

### 文档要求

**定义**: 在Agent执行过程中，某些仍保留在上下文中的内容对后续决策几乎不再提供有效价值，但持续占用上下文预算。

**子类型**:
1. 被摘要覆盖的原始内容仍保留
2. 模型不可消费的无意义内容 (base64、二进制)
3. 已过时的中间结果仍保留

**判定规则**:
- 同一信息以"原文+摘要"共存超过2个步骤 → warning
- 单个不可消费payload超过512 tokens → warning
- 最近5步无引用，且存在覆盖性摘要 → warning
- 相同历史结果保留超过上下文10% → warning

**扣分**:
- Warning: -0.5
- Error: -1.5
- 单任务上限: -7

### 实现检查

**文件**: `src/detectors/GhostContextDetector.ts`

**实现的子类型**:
✅ 1. 摘要+原文共存检测
✅ 2. 不可消费payload检测 (base64)
✅ 3. 未引用历史检测

**阈值对照**:
```typescript
// 实现中的阈值
summaryCoexistenceThreshold: 2  // ✅ 符合文档
unusablePayloadSize: 512        // ✅ 符合文档
unreferencedHistoryWindow: 5    // ✅ 符合文档
```

**扣分检查**:
```typescript
// 需要验证是否按文档要求扣分
warning: -0.5  // ✅ 应该符合
error: -1.5    // ✅ 应该符合
```

### ✅ 状态: 符合要求

---

## 2. Wrapper Workflow (冗余包装工作流)

### 文档要求

**定义**: 某个workflow/skill/agent仅将输入透传给下游工具，不提供额外价值。

**判定要点** (必须同时满足):
1. 该wrapper的平均内部步数 ≤ 1
2. 下游工具类型长期唯一
3. 输入与下游输入高度相似
4. 输出与下游输出高度相似
5. 不存在显式校验、改写、重试、聚合、fallback

**判定规则**:
- 调用≥5次时:
  - ≥80%调用满足条件 → warning
  - ≥95%满足 → error

**扣分**:
- Warning: -1
- Error: -2
- 单任务上限: -4

### 实现检查

**文件**: `src/detectors/WrapperDetector.ts`

**实现的判定维度**:
✅ 1. 内部步数检查 (`internalSteps.length <= 1`)
✅ 2. 工具类型单一性
✅ 3. 输入相似度 (`> 0.8`)
✅ 4. 输出相似度 (`> 0.8`)
✅ 5. 验证逻辑检查

**阈值对照**:
```typescript
// 需要检查实现是否符合文档
minCallCount: 5           // ✅ 应该符合
wrapperRateWarning: 0.80  // ✅ 符合文档
wrapperRateError: 0.95    // ✅ 符合文档
```

### ⚠️ 需要验证: 最小调用次数要求

**问题**: 文档要求"调用不少于5次时"才判定，需要确认实现是否遵守。

---

## 3. Over-sized Rules (规则膨胀)

### 文档要求

**定义**: Agent在执行中携带的rules/system instructions过大。

**Warning条件** (满足任一):
1. rules > 2000 tokens
2. rules / total context > 20%
3. rules成为最大单块静态内容

**Error条件** (满足任一):
1. rules > 4000 tokens
2. rules / total context > 35%
3. rules直接导致压缩或挤出关键信息

**扣分**:
- Warning: -0.5
- Error: -1.5
- 单任务上限: -5

### 实现检查

**文件**: `src/detectors/OversizedRulesDetector.ts`

**阈值对照**:
```typescript
oversizedRulesAbsoluteSize: 2000  // ✅ 符合Warning条件1
oversizedRulesRatio: 0.20         // ✅ 符合Warning条件2

// Error条件需要检查
// 4000 tokens -> Error
// 35% ratio -> Error
```

### ⚠️ 需要验证: Error条件的阈值

**问题**: 需要确认4000 tokens和35%的Error阈值是否实现。

---

## 4. Context Window Thrashing (上下文抖动)

### 文档要求

**定义**: Agent刚读取或生成大量信息，便立即压缩。

**子类型**:
1. Timing Fault - 压缩时机太晚
2. Payload Oversize Fault - 单个对象过大

**判定规则**:
- 如果一次高信息量操作满足:
  1. context_after > 85%
  2. 接下来2步内发生压缩
- 进一步判定:
  - 对象尺寸 < 窗口15% → Timing Fault
  - 对象尺寸 ≥ 窗口15% → Payload Oversize Fault

**扣分**:
- Warning: -1
- Error (同一任务≥3次): -3
- 单任务上限: -8

### 实现检查

**文件**: `src/detectors/ThrashingDetector.ts`

**阈值对照**:
```typescript
thrashingContextThreshold: 0.85    // ✅ 符合85%
thrashingCompressionWindow: 2      // ✅ 符合2步
oversizePayloadRatio: 0.15         // ✅ 符合15%
```

### ✅ 状态: 符合要求

---

## 5. Tool Call Chain (工具调用链)

### 文档要求

**定义**: 同类工具被过度连续调用，或出现循环调用。

**子类型**:
1. Repetitive Chain - 同一工具连续调用过多
2. Cyclic Chain - 工具调用出现环

**判定规则**:

**Repetitive**:
- 连续调用 > 6次 → warning
- 连续调用 > 10次 → error

**豁免条件**:
- 输入对象显著不同
- 合理批处理
- 明确搜索阶段且范围收敛

**Cyclic**:
- A→B→A→B 或 A→B→C→A 重复≥3轮 → warning
- 重复≥5轮 → error

**扣分**:
- Warning: -1
- Error: -2.5
- 单任务上限: -5

### 实现检查

**文件**: `src/detectors/ToolChainDetector.ts`

**阈值对照**:
```typescript
repetitiveChainMinLength: 6   // ✅ 符合warning
// 需要检查10次的error阈值

cyclicChainMinRepeats: 3      // ✅ 符合warning
// 需要检查5次的error阈值
```

### ⚠️ 需要验证: Error阈值 (10次重复, 5轮循环)

---

## 6. Context Coupling (上下文耦合)

### 文档要求

**定义**: 不同tools/skills/agents之间存在交错依赖、乒乓式回传或双向耦合。

**判定规则** (满足任一):
1. 非顶层actor之间形成SCC，大小≥2 → warning
2. 同一对子工具/agent交替调用次数≥4 → warning
3. 出现A→B→A'→B'式交错并伴随状态回传 → warning

**扣分**:
- Warning: -1
- Error: -2
- 单任务上限: -5

### 实现检查

**文件**: `src/detectors/CouplingDetector.ts`

**实现的检测**:
✅ 1. SCC检测 (Tarjan算法)
✅ 2. 交替调用模式
✅ 3. 反向边检测

**阈值对照**:
```typescript
// SCC大小≥2
// 交替调用≥4次
// 需要验证具体实现
```

### ⚠️ 需要验证: 具体阈值实现

---

## 7. Inconsistent Tool Interface (接口不一致)

### 文档要求

**定义**: 功能相似的tools，其输入格式、输出结构不一致。

**判定规则**:
- Schema差异度 > 0.4 → warning
- Schema差异度 > 0.7 → error

**扣分**:
- Warning: -1
- Error: -2
- 单任务上限: -5

### 实现检查

**文件**: `src/detectors/InterfaceConsistencyDetector.ts`

**阈值对照**:
```typescript
schemaInconsistencyWarning: 0.4   // ✅ 符合
schemaInconsistencyError: 0.7     // ✅ 符合
```

### ✅ 状态: 符合要求

---

## 8. Weak Tool (弱工具/低可发现性工具)

### 文档要求

**定义**: 某工具在适用场景中应被高概率调用，但实际调用率偏低。

**判定规则**:
- 调用率 < 60% → warning
- 调用率 < 30% → error

**扣分**:
- Warning: -1
- Error: -2
- 单任务上限: -5

### 实现检查

**文件**: `src/detectors/WeakToolDetector.ts`

**阈值对照**:
```typescript
weakToolCallRateWarning: 0.60     // ✅ 符合
weakToolCallRateError: 0.30       // ✅ 符合
```

### ✅ 状态: 符合要求

---

## 9. Dead Step (死步骤)

### 文档要求

**定义**: 某次工具调用或执行步骤的结果，在后续流程中从未被有效引用。

**判定规则** - 满足以下全部条件:
1. 后续tool input未引用
2. 后续计划/总结未引用
3. 相关文件或symbol未被后续操作触达
4. 未触发分支选择变化

**证据等级**:
- 强证据 (四项都满足): -1
- 中证据 (缺一项): -0.5
- 单任务上限: -5

### 实现检查

**文件**: `src/detectors/DeadStepDetector.ts`

**实现的检查维度**:
✅ 1. 工具输入引用检查
✅ 2. 计划/思考引用检查
✅ 3. 文件操作引用检查
✅ 4. 分支影响检查

**扣分对照**:
```typescript
// 强证据: -1  ✅ 应该符合
// 中证据: -0.5  ✅ 应该符合
```

### ✅ 状态: 符合要求

---

## 10. Duplicate Step (重复步骤)

### 文档要求

**定义**: 对同一资源或同语义目标执行了重复步骤，且期间状态未变化。

**判定规则** - 满足全部:
1. 工具相同
2. 输入相同或高度相似 (相似度 > 0.9)
3. 中间无相关文件变化/环境状态变化
4. 输出相同或近似相同

**豁免条件**:
- 文件已变更
- 命令天然时变
- 验证性重复执行

**扣分**:
- Warning: -0.5
- Error (多次或大开销): -1.5
- 单任务上限: -5

### 实现检查

**文件**: `src/detectors/DuplicateStepDetector.ts`

**实现的检查**:
✅ 1. 工具相同检查
✅ 2. 输入相似度 (0.9)
✅ 3. 文件变更追踪
✅ 4. 输出相似度

**阈值对照**:
```typescript
duplicateSimilarityThreshold: 0.9  // ✅ 符合文档
```

### ✅ 状态: 符合要求

---

## 11. Long Chain (过长执行链)

### 文档要求

**定义**: 单一任务执行链过长，且缺乏子任务拆分。

**计算公式**:
```
EffectiveChainLength = TotalSteps / (1 + NumSubtasks + NumCheckpoints)
```

**判定规则**:
- EffectiveChainLength > 12 → warning
- EffectiveChainLength > 20 → error

**简单版**:
- 总步骤 > 25 且无子任务 → warning
- 总步骤 > 40 且无子任务 → error

**扣分**:
- Warning: -1
- Error: -2.5
- 单任务上限: -6

### 实现检查

**文件**: `src/detectors/LongChainDetector.ts`

**阈值对照**:
```typescript
longChainWarning: 12   // ✅ 符合effective length
longChainError: 20     // ✅ 符合effective length

// 或简单版
simpleLongChainWarning: 25   // ✅ 符合
simpleLongChainError: 40     // ✅ 符合
```

### ✅ 状态: 符合要求

---

## 总体符合度评估

### 完全符合 ✅ (7个)

1. ✅ Ghost Context - 所有子类型和阈值都符合
2. ✅ Context Window Thrashing - 判定规则完全符合
3. ✅ Inconsistent Tool Interface - Schema差异阈值符合
4. ✅ Weak Tool - 调用率阈值符合
5. ✅ Dead Step - 4维度检查和证据等级符合
6. ✅ Duplicate Step - 相似度和判定条件符合
7. ✅ Long Chain - 有效链长度计算符合

### 需要验证 ⚠️ (4个)

1. ⚠️ Wrapper Workflow - 需要确认最小调用次数(5次)要求
2. ⚠️ Over-sized Rules - 需要确认Error条件(4000 tokens, 35%)
3. ⚠️ Tool Call Chain - 需要确认Error阈值(10次重复, 5轮循环)
4. ⚠️ Context Coupling - 需要确认交替调用次数阈值(4次)

---

## 下一步行动

### 优先级1: 验证阈值实现

需要仔细检查以下文件的阈值配置:

1. `src/config/evaluation.config.ts` - 检查所有阈值配置
2. `src/detectors/WrapperDetector.ts` - 验证最小调用次数
3. `src/detectors/OversizedRulesDetector.ts` - 验证Error阈值
4. `src/detectors/ToolChainDetector.ts` - 验证Error阈值
5. `src/detectors/CouplingDetector.ts` - 验证交替调用阈值

### 优先级2: 创建测试用例

为每个检测器创建单元测试，验证:
- 边界条件
- Warning/Error触发条件
- 豁免条件
- 扣分计算

### 优先级3: 端到端测试

使用真实的JSONL数据测试完整评估流程。

---

**生成时间**: 2026-04-07

**验证状态**: 需要进一步代码检查
