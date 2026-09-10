# 发现的问题与修复方案

## ❌ 问题1: WrapperDetector缺少"最少调用5次"检查

### 文档要求

根据 `acoder version.md` 第7.2节:

> **默认判定规则**: 在同一benchmark中某wrapper被调用**不少于5次**时：
> - 若≥80%的调用都满足上述条件，则报warning
> - 若≥95%满足，则报error

###当前实现问题

**文件**: `src/detectors/WrapperDetector.ts`

**问题描述**:
- ❌ 没有检查Agent的调用次数
- ❌ 没有实现"调用5次以上才判定"的逻辑
- ❌ 当前对每个Agent调用都进行判定，不符合文档要求

### 影响

这会导致：
1. **误报**: 只被调用1-2次的Agent也可能被标记为wrapper
2. **不准确**: 无法统计"多次调用中有多少比例是wrapper行为"
3. **不符合文档**: 违反了评测标准的明确要求

### 修复方案

需要修改 `WrapperDetector.ts` 的 `detect()` 方法:

```typescript
async detect(): Promise<DetectionIssue[]> {
  const issues: DetectionIssue[] = [];

  // 识别所有Agent调用
  const agentCalls = this.identifyAgentCalls();

  // 按agentId分组统计
  const agentCallGroups = new Map<string, Array<...>>();

  for (const agentCall of agentCalls) {
    const agentId = agentCall.agentId;
    if (!agentCallGroups.has(agentId)) {
      agentCallGroups.set(agentId, []);
    }
    agentCallGroups.get(agentId)!.push(agentCall);
  }

  // 对每个Agent检查调用次数
  for (const [agentId, calls] of agentCallGroups) {
    // ✅ 关键修复: 只对调用≥5次的Agent进行判定
    if (calls.length < 5) {
      continue; // 跳过调用次数不足的Agent
    }

    // 分析每次调用
    let wrapperCount = 0;
    for (const call of calls) {
      const analysis = this.analyzeAgentCall(call);
      if (analysis.isWrapper) {
        wrapperCount++;
      }
    }

    // 计算包装率
    const wrapperRate = wrapperCount / calls.length;

    // 判定
    if (wrapperRate >= 0.80) {
      const severity = wrapperRate >= 0.95 ? Severity.Error : Severity.Warning;
      const deduction = severity === Severity.Error ? 2.0 : 1.0;

      issues.push({
        metric: 'wrapperWorkflow',
        severity,
        message: `检测到冗余包装工作流: Agent "${agentId}" 在${calls.length}次调用中有${wrapperCount}次(${(wrapperRate * 100).toFixed(0)}%)仅透传输入`,
        location: {
          messageUuid: calls[0].initiatorUuid,
        },
        suggestion: `该Agent没有提供附加价值，考虑直接调用下游工具，或为Agent添加验证、转换等逻辑`,
        evidence: {
          type: severity === Severity.Error ? 'strong' : 'medium',
          details: {
            agentId,
            totalCalls: calls.length,
            wrapperCalls: wrapperCount,
            wrapperRate,
          },
        },
        deduction,
      });
    }
  }

  return issues;
}
```

### 测试用例

需要添加测试验证修复:

```typescript
describe('WrapperDetector', () => {
  it('应该忽略调用次数<5的Agent', async () => {
    const session = createMockSession({
      agents: [
        { id: 'agent1', calls: 3, isWrapper: true }, // 只调用3次
      ]
    });

    const detector = new WrapperDetector(session, config);
    const issues = await detector.detect();

    // 不应该报告任何问题，因为调用次数<5
    expect(issues.length).toBe(0);
  });

  it('应该在调用≥5次且80%是wrapper时报warning', async () => {
    const session = createMockSession({
      agents: [
        { id: 'agent1', calls: 5, wrapperCalls: 4 }, // 80%
      ]
    });

    const detector = new WrapperDetector(session, config);
    const issues = await detector.detect();

    expect(issues.length).toBe(1);
    expect(issues[0].severity).toBe('warning');
  });

  it('应该在调用≥5次且95%是wrapper时报error', async () => {
    const session = createMockSession({
      agents: [
        { id: 'agent1', calls: 20, wrapperCalls: 19 }, // 95%
      ]
    });

    const detector = new WrapperDetector(session, config);
    const issues = await detector.detect();

    expect(issues.length).toBe(1);
    expect(issues[0].severity).toBe('error');
  });
});
```

---

## ✅ 其他检测器状态

经过仔细对照文档，其他10个检测器的实现都符合要求：

### 完全符合 ✅

1. ✅ **GhostContextDetector** - 所有阈值和逻辑都符合
2. ✅ **OversizedRulesDetector** - 2000/4000 tokens, 20%/35%比例都正确
3. ✅ **ThrashingDetector** - 85%阈值, 2步检查, 15%payload都正确
4. ✅ **ToolChainDetector** - 6/10次重复, 3/5轮循环都正确
5. ✅ **DeadStepDetector** - 4维度检查, 强/中证据都正确
6. ✅ **DuplicateStepDetector** - 0.9相似度阈值正确
7. ✅ **LongChainDetector** - 12/20有效长度, 25/40简单长度都正确
8. ✅ **CouplingDetector** - Tarjan SCC算法, 交替调用检测都正确
9. ✅ **InterfaceConsistencyDetector** - 0.4/0.7差异度阈值正确
10. ✅ **WeakToolDetector** - 60%/30%调用率阈值正确
11. ✅ **TaskOutcomeEvaluator** - 5个完成指标的启发式检查逻辑完整

---

## 修复优先级

### 🔴 高优先级 (必须修复)

1. **WrapperDetector** - 添加"最少5次调用"检查
   - 影响: 直接违反文档要求
   - 修复难度: 中等
   - 估计时间: 30分钟

### 🟡 中优先级 (建议修复)

无

### 🟢 低优先级 (可选增强)

1. 添加单元测试 - 验证所有边界条件
2. 添加集成测试 - 使用真实数据验证
3. 性能优化 - 缓存中间结果

---

## 修复计划

### 步骤1: 修复WrapperDetector (立即执行)

1. 修改 `src/detectors/WrapperDetector.ts`
2. 实现按agentId分组统计
3. 添加调用次数检查 (≥5次)
4. 计算多次调用的包装率
5. 更新问题报告格式

### 步骤2: 添加测试 (后续)

1. 创建单元测试框架
2. 为WrapperDetector添加测试
3. 验证边界条件

### 步骤3: 验证修复 (最后)

1. 运行测试确保通过
2. 使用真实JSONL数据验证
3. 更新文档

---

## 总结

### 发现的问题

- **1个关键问题**: WrapperDetector缺少最少调用次数检查
- **0个次要问题**
- **10个检测器完全符合要求**

### 整体符合度

- **完全符合**: 10/11 = 90.9%
- **需要修复**: 1/11 = 9.1%

### 修复后预期

修复WrapperDetector后，所有11个检测器将**100%符合文档要求** ✅

---

**报告生成时间**: 2026-04-07

**下一步**: 立即修复WrapperDetector.ts
