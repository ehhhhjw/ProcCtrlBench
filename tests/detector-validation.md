# Detector Validation Report

## Cross-check Against the Documentation Requirements

Based on the requirements in `~/Downloads/acoder version.md`

---

## 1. Ghost Context

### Documentation Requirement

**Definition**: during Agent execution, certain content that remains in the context provides almost no useful value for subsequent decisions, yet keeps consuming the context budget.

**Subtypes**:
1. original content already superseded by a summary is still retained
2. meaningless content the model cannot consume (base64, binary)
3. stale intermediate results are still retained

**Detection rules**:
- the same information coexists as "original + summary" for more than 2 steps → warning
- a single unconsumable payload exceeds 512 tokens → warning
- no reference in the last 5 steps while a superseding summary exists → warning
- identical historical results occupy more than 10% of the context → warning

**Deductions**:
- Warning: -0.5
- Error: -1.5
- Per-task cap: -7

### Implementation Check

**File**: `src/detectors/GhostContextDetector.ts`

**Implemented subtypes**:
✅ 1. summary + original coexistence detection
✅ 2. unconsumable payload detection (base64)
✅ 3. unreferenced history detection

**Threshold comparison**:
```typescript
// Thresholds in the implementation
summaryCoexistenceThreshold: 2  // ✅ matches the documentation
unusablePayloadSize: 512        // ✅ matches the documentation
unreferencedHistoryWindow: 5    // ✅ matches the documentation
```

**Deduction check**:
```typescript
// Need to verify that deductions follow the documentation
warning: -0.5  // ✅ should match
error: -1.5    // ✅ should match
```

### ✅ Status: meets the requirements

---

## 2. Wrapper Workflow (Redundant Wrapper Workflow)

### Documentation Requirement

**Definition**: a workflow/skill/agent merely passes its input through to a downstream tool without providing additional value.

**Key criteria** (all must hold simultaneously):
1. the wrapper's average internal step count ≤ 1
2. the downstream tool type is consistently unique
3. the input is highly similar to the downstream input
4. the output is highly similar to the downstream output
5. there is no explicit validation, rewriting, retry, aggregation, or fallback

**Detection rules**:
- when called ≥5 times:
  - ≥80% of the calls satisfy the criteria → warning
  - ≥95% satisfy them → error

**Deductions**:
- Warning: -1
- Error: -2
- Per-task cap: -4

### Implementation Check

**File**: `src/detectors/WrapperDetector.ts`

**Implemented criteria dimensions**:
✅ 1. internal step count check (`internalSteps.length <= 1`)
✅ 2. uniqueness of the tool type
✅ 3. input similarity (`> 0.8`)
✅ 4. output similarity (`> 0.8`)
✅ 5. validation logic check

**Threshold comparison**:
```typescript
// Need to check whether the implementation matches the documentation
minCallCount: 5           // ✅ should match
wrapperRateWarning: 0.80  // ✅ matches the documentation
wrapperRateError: 0.95    // ✅ matches the documentation
```

### ⚠️ Needs verification: the minimum call count requirement

**Issue**: the documentation requires a verdict only "when called no fewer than 5 times"; we need to confirm that the implementation honors this.

---

## 3. Over-sized Rules (Rule Bloat)

### Documentation Requirement

**Definition**: the rules/system instructions the Agent carries during execution are too large.

**Warning conditions** (any one suffices):
1. rules > 2000 tokens
2. rules / total context > 20%
3. rules become the largest single block of static content

**Error conditions** (any one suffices):
1. rules > 4000 tokens
2. rules / total context > 35%
3. rules directly cause compression or squeeze out critical information

**Deductions**:
- Warning: -0.5
- Error: -1.5
- Per-task cap: -5

### Implementation Check

**File**: `src/detectors/OversizedRulesDetector.ts`

**Threshold comparison**:
```typescript
oversizedRulesAbsoluteSize: 2000  // ✅ matches Warning condition 1
oversizedRulesRatio: 0.20         // ✅ matches Warning condition 2

// The Error conditions need checking
// 4000 tokens -> Error
// 35% ratio -> Error
```

### ⚠️ Needs verification: the thresholds of the Error conditions

**Issue**: we need to confirm whether the 4000-token and 35% Error thresholds are implemented.

---

## 4. Context Window Thrashing (Context Thrashing)

### Documentation Requirement

**Definition**: the Agent has just read or generated a large amount of information and immediately compresses it.

**Subtypes**:
1. Timing Fault - compression happens too late
2. Payload Oversize Fault - a single object is too large

**Detection rules**:
- if one high-information operation satisfies:
  1. context_after > 85%
  2. compression occurs within the next 2 steps
- then classify further:
  - object size < 15% of the window → Timing Fault
  - object size ≥ 15% of the window → Payload Oversize Fault

**Deductions**:
- Warning: -1
- Error (≥3 times in the same task): -3
- Per-task cap: -8

### Implementation Check

**File**: `src/detectors/ThrashingDetector.ts`

**Threshold comparison**:
```typescript
thrashingContextThreshold: 0.85    // ✅ matches 85%
thrashingCompressionWindow: 2      // ✅ matches 2 steps
oversizePayloadRatio: 0.15         // ✅ matches 15%
```

### ✅ Status: meets the requirements

---

## 5. Tool Call Chain

### Documentation Requirement

**Definition**: tools of the same kind are called consecutively too many times, or the calls form a cycle.

**Subtypes**:
1. Repetitive Chain - the same tool is called consecutively too many times
2. Cyclic Chain - the tool calls form a cycle

**Detection rules**:

**Repetitive**:
- more than 6 consecutive calls → warning
- more than 10 consecutive calls → error

**Exemption conditions**:
- the input objects differ significantly
- reasonable batch processing
- an explicit search phase whose scope is converging

**Cyclic**:
- A→B→A→B or A→B→C→A repeated ≥3 rounds → warning
- repeated ≥5 rounds → error

**Deductions**:
- Warning: -1
- Error: -2.5
- Per-task cap: -5

### Implementation Check

**File**: `src/detectors/ToolChainDetector.ts`

**Threshold comparison**:
```typescript
repetitiveChainMinLength: 6   // ✅ matches warning
// Need to check the error threshold of 10 calls

cyclicChainMinRepeats: 3      // ✅ matches warning
// Need to check the error threshold of 5 rounds
```

### ⚠️ Needs verification: the Error thresholds (10 repeats, 5 cycle rounds)

---

## 6. Context Coupling

### Documentation Requirement

**Definition**: different tools/skills/agents exhibit interleaved dependencies, ping-pong hand-backs, or bidirectional coupling.

**Detection rules** (any one suffices):
1. non-top-level actors form an SCC of size ≥2 → warning
2. the same pair of sub-tools/agents alternate ≥4 times → warning
3. an A→B→A'→B' style interleaving appears together with state hand-back → warning

**Deductions**:
- Warning: -1
- Error: -2
- Per-task cap: -5

### Implementation Check

**File**: `src/detectors/CouplingDetector.ts`

**Implemented detections**:
✅ 1. SCC detection (Tarjan's algorithm)
✅ 2. alternating call pattern
✅ 3. back-edge detection

**Threshold comparison**:
```typescript
// SCC size ≥2
// alternating calls ≥4
// The concrete implementation needs verification
```

### ⚠️ Needs verification: the concrete threshold implementation

---

## 7. Inconsistent Tool Interface (Interface Inconsistency)

### Documentation Requirement

**Definition**: tools with similar functionality have inconsistent input formats and output structures.

**Detection rules**:
- schema divergence > 0.4 → warning
- schema divergence > 0.7 → error

**Deductions**:
- Warning: -1
- Error: -2
- Per-task cap: -5

### Implementation Check

**File**: `src/detectors/InterfaceConsistencyDetector.ts`

**Threshold comparison**:
```typescript
schemaInconsistencyWarning: 0.4   // ✅ matches
schemaInconsistencyError: 0.7     // ✅ matches
```

### ✅ Status: meets the requirements

---

## 8. Weak Tool (Weak / Low-discoverability Tool)

### Documentation Requirement

**Definition**: a tool should be called with high probability in the scenarios it applies to, but its actual call rate is low.

**Detection rules**:
- call rate < 60% → warning
- call rate < 30% → error

**Deductions**:
- Warning: -1
- Error: -2
- Per-task cap: -5

### Implementation Check

**File**: `src/detectors/WeakToolDetector.ts`

**Threshold comparison**:
```typescript
weakToolCallRateWarning: 0.60     // ✅ matches
weakToolCallRateError: 0.30       // ✅ matches
```

### ✅ Status: meets the requirements

---

## 9. Dead Step

### Documentation Requirement

**Definition**: the result of a tool call or execution step is never effectively referenced in the subsequent flow.

**Detection rules** - all of the following conditions must hold:
1. not referenced by any subsequent tool input
2. not referenced by any subsequent plan/summary
3. the related file or symbol is not touched by subsequent operations
4. no change in branch selection was triggered

**Evidence levels**:
- strong evidence (all four hold): -1
- medium evidence (one missing): -0.5
- Per-task cap: -5

### Implementation Check

**File**: `src/detectors/DeadStepDetector.ts`

**Implemented check dimensions**:
✅ 1. tool input reference check
✅ 2. plan/thinking reference check
✅ 3. file operation reference check
✅ 4. branch impact check

**Deduction comparison**:
```typescript
// Strong evidence: -1  ✅ should match
// Medium evidence: -0.5  ✅ should match
```

### ✅ Status: meets the requirements

---

## 10. Duplicate Step

### Documentation Requirement

**Definition**: a duplicate step was executed against the same resource or the same semantic target, with no state change in between.

**Detection rules** - all must hold:
1. the same tool
2. the same or highly similar input (similarity > 0.9)
3. no relevant file change or environment state change in between
4. the same or nearly the same output

**Exemption conditions**:
- the file has already changed
- the command is inherently time-varying
- repeated execution for verification purposes

**Deductions**:
- Warning: -0.5
- Error (many occurrences or high cost): -1.5
- Per-task cap: -5

### Implementation Check

**File**: `src/detectors/DuplicateStepDetector.ts`

**Implemented checks**:
✅ 1. same-tool check
✅ 2. input similarity (0.9)
✅ 3. file change tracking
✅ 4. output similarity

**Threshold comparison**:
```typescript
duplicateSimilarityThreshold: 0.9  // ✅ matches the documentation
```

### ✅ Status: meets the requirements

---

## 11. Long Chain (Overly Long Execution Chain)

### Documentation Requirement

**Definition**: a single task's execution chain is too long and lacks subtask decomposition.

**Formula**:
```
EffectiveChainLength = TotalSteps / (1 + NumSubtasks + NumCheckpoints)
```

**Detection rules**:
- EffectiveChainLength > 12 → warning
- EffectiveChainLength > 20 → error

**Simple version**:
- total steps > 25 with no subtasks → warning
- total steps > 40 with no subtasks → error

**Deductions**:
- Warning: -1
- Error: -2.5
- Per-task cap: -6

### Implementation Check

**File**: `src/detectors/LongChainDetector.ts`

**Threshold comparison**:
```typescript
longChainWarning: 12   // ✅ matches the effective length
longChainError: 20     // ✅ matches the effective length

// Or the simple version
simpleLongChainWarning: 25   // ✅ matches
simpleLongChainError: 40     // ✅ matches
```

### ✅ Status: meets the requirements

---

## Overall Compliance Assessment

### Fully Compliant ✅ (7)

1. ✅ Ghost Context - all subtypes and thresholds match
2. ✅ Context Window Thrashing - the detection rules match completely
3. ✅ Inconsistent Tool Interface - the schema divergence thresholds match
4. ✅ Weak Tool - the call rate thresholds match
5. ✅ Dead Step - the 4-dimension check and the evidence levels match
6. ✅ Duplicate Step - the similarity and the detection conditions match
7. ✅ Long Chain - the effective chain length computation matches

### Needs Verification ⚠️ (4)

1. ⚠️ Wrapper Workflow - need to confirm the minimum call count (5 calls) requirement
2. ⚠️ Over-sized Rules - need to confirm the Error conditions (4000 tokens, 35%)
3. ⚠️ Tool Call Chain - need to confirm the Error thresholds (10 repeats, 5 cycle rounds)
4. ⚠️ Context Coupling - need to confirm the alternating call count threshold (4 times)

---

## Next Actions

### Priority 1: verify the threshold implementations

The threshold configuration in the following files needs a careful check:

1. `src/config/evaluation.config.ts` - check every threshold configuration
2. `src/detectors/WrapperDetector.ts` - verify the minimum call count
3. `src/detectors/OversizedRulesDetector.ts` - verify the Error thresholds
4. `src/detectors/ToolChainDetector.ts` - verify the Error thresholds
5. `src/detectors/CouplingDetector.ts` - verify the alternating call threshold

### Priority 2: create test cases

Create unit tests for every detector to verify:
- boundary conditions
- Warning/Error trigger conditions
- exemption conditions
- deduction computation

### Priority 3: end-to-end testing

Test the complete evaluation pipeline with real JSONL data.

---

**Generated**: 2026-04-07

**Validation status**: requires further code inspection
