# Issues Found and Fix Plan

## ❌ Issue 1: WrapperDetector is missing the "at least 5 calls" check

### Documentation Requirement

According to section 7.2 of `acoder version.md`:

> **Default detection rule**: when a wrapper is called **no fewer than 5 times** within the same benchmark:
> - if ≥80% of the calls satisfy the conditions above, report a warning
> - if ≥95% satisfy them, report an error

### Problems in the Current Implementation

**File**: `src/detectors/WrapperDetector.ts`

**Problem description**:
- ❌ the Agent's call count is not checked
- ❌ the "only judge when called more than 5 times" logic is not implemented
- ❌ a verdict is currently issued for every single Agent call, which does not meet the documentation requirement

### Impact

This leads to:
1. **False positives**: an Agent called only 1-2 times may also be flagged as a wrapper
2. **Inaccuracy**: it is impossible to measure "what proportion of multiple calls exhibits wrapper behavior"
3. **Non-compliance with the documentation**: it violates an explicit requirement of the evaluation standard

### Fix Plan

The `detect()` method of `WrapperDetector.ts` needs to be modified:

```typescript
async detect(): Promise<DetectionIssue[]> {
  const issues: DetectionIssue[] = [];

  // Identify all Agent calls
  const agentCalls = this.identifyAgentCalls();

  // Group and tally by agentId
  const agentCallGroups = new Map<string, Array<...>>();

  for (const agentCall of agentCalls) {
    const agentId = agentCall.agentId;
    if (!agentCallGroups.has(agentId)) {
      agentCallGroups.set(agentId, []);
    }
    agentCallGroups.get(agentId)!.push(agentCall);
  }

  // Check the call count for each Agent
  for (const [agentId, calls] of agentCallGroups) {
    // ✅ Key fix: only judge Agents called ≥5 times
    if (calls.length < 5) {
      continue; // Skip Agents with too few calls
    }

    // Analyze each call
    let wrapperCount = 0;
    for (const call of calls) {
      const analysis = this.analyzeAgentCall(call);
      if (analysis.isWrapper) {
        wrapperCount++;
      }
    }

    // Compute the wrapper rate
    const wrapperRate = wrapperCount / calls.length;

    // Verdict
    if (wrapperRate >= 0.80) {
      const severity = wrapperRate >= 0.95 ? Severity.Error : Severity.Warning;
      const deduction = severity === Severity.Error ? 2.0 : 1.0;

      issues.push({
        metric: 'wrapperWorkflow',
        severity,
        message: `Redundant wrapper workflow detected: Agent "${agentId}" in ${calls.length} invocations merely passed input through ${wrapperCount} times (${(wrapperRate * 100).toFixed(0)}%)`,
        location: {
          messageUuid: calls[0].initiatorUuid,
        },
        suggestion: `This Agent provides no added value. Consider invoking the downstream tool directly, or adding validation, transformation, or similar logic to the Agent`,
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

### Test Cases

Tests need to be added to verify the fix:

```typescript
describe('WrapperDetector', () => {
  it('should ignore Agents with a call count < 5', async () => {
    const session = createMockSession({
      agents: [
        { id: 'agent1', calls: 3, isWrapper: true }, // called only 3 times
      ]
    });

    const detector = new WrapperDetector(session, config);
    const issues = await detector.detect();

    // No issue should be reported, because the call count < 5
    expect(issues.length).toBe(0);
  });

  it('should report a warning when called ≥5 times with 80% wrappers', async () => {
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

  it('should report an error when called ≥5 times with 95% wrappers', async () => {
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

## ✅ Status of the Other Detectors

After a careful comparison against the documentation, the implementations of the other 10 detectors all meet the requirements:

### Fully Compliant ✅

1. ✅ **GhostContextDetector** - all thresholds and logic match
2. ✅ **OversizedRulesDetector** - 2000/4000 tokens and the 20%/35% ratios are all correct
3. ✅ **ThrashingDetector** - the 85% threshold, the 2-step check, and the 15% payload are all correct
4. ✅ **ToolChainDetector** - 6/10 repeats and 3/5 cycle rounds are all correct
5. ✅ **DeadStepDetector** - the 4-dimension check and the strong/medium evidence levels are all correct
6. ✅ **DuplicateStepDetector** - the 0.9 similarity threshold is correct
7. ✅ **LongChainDetector** - 12/20 effective length and 25/40 simple length are all correct
8. ✅ **CouplingDetector** - Tarjan's SCC algorithm and alternating-call detection are both correct
9. ✅ **InterfaceConsistencyDetector** - the 0.4/0.7 divergence thresholds are correct
10. ✅ **WeakToolDetector** - the 60%/30% call-rate thresholds are correct
11. ✅ **TaskOutcomeEvaluator** - the heuristic check logic for the 5 completion metrics is complete

---

## Fix Priority

### 🔴 High Priority (must fix)

1. **WrapperDetector** - add the "at least 5 calls" check
   - Impact: directly violates the documentation requirement
   - Fix difficulty: medium
   - Estimated time: 30 minutes

### 🟡 Medium Priority (recommended)

None

### 🟢 Low Priority (optional enhancements)

1. Add unit tests - verify all boundary conditions
2. Add integration tests - verify with real data
3. Performance optimization - cache intermediate results

---

## Fix Schedule

### Step 1: Fix WrapperDetector (execute immediately)

1. Modify `src/detectors/WrapperDetector.ts`
2. Implement grouped statistics by agentId
3. Add the call count check (≥5 calls)
4. Compute the wrapper rate across multiple calls
5. Update the issue report format

### Step 2: Add Tests (follow-up)

1. Create a unit test framework
2. Add tests for WrapperDetector
3. Verify boundary conditions

### Step 3: Verify the Fix (last)

1. Run the tests and make sure they pass
2. Verify with real JSONL data
3. Update the documentation

---

## Summary

### Issues Found

- **1 critical issue**: WrapperDetector is missing the minimum call count check
- **0 minor issues**
- **10 detectors fully meet the requirements**

### Overall Compliance

- **Fully compliant**: 10/11 = 90.9%
- **Needs fixing**: 1/11 = 9.1%

### Expectation After the Fix

Once WrapperDetector is fixed, all 11 detectors will be **100% compliant with the documentation requirements** ✅

---

**Report generated**: 2026-04-07

**Next step**: fix WrapperDetector.ts immediately
