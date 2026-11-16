# The Current 11 Benchmark Evaluation Schemes

This document consolidates the 11 evaluation benchmark schemes that are actually implemented in the current repository, describing each of them in a uniform way:
- The data foundation on which the evaluation relies
- The detection signals and decision logic of each benchmark
- The current thresholds and penalty scheme
- False positive control
- Recommended remediation directions

This document reflects the current implementation; the relevant code resides mainly in `src/detectors/`, `src/analyzers/`, and `src/config/evaluation.config.ts`.

## I. Unified Data Foundation

### 1. Trajectory Data
- Source: `SessionData`
- Main fields:
  - `messages`
  - `toolUses`
  - `toolResults`
  - `agents`
  - `replacements`
- Purpose: to recover the execution chain, context changes, tool invocation order, file reads and writes, and Agent branching and compaction behavior.

### 2. File Association Graph
- Artifact: `output/file-graph.json`
- Role: to determine indirect associations, indirect changes, and indirect references among files.
- Loader: `src/analyzers/FileAssociationLoader.ts`

### 3. Project-Level AST Analysis
- Artifact: `output/project-ast.json`
- Build script: `scripts/build-file-graph.ts`
- Configuration file: `config/project-analysis.config.json`
- Configurable options:
  - `projectPath`: the path of the project to be analyzed
  - `relatedFilesDataPath`: the path of the external related-files data
- AST capabilities:
  - Full multi-language parsing based on tree-sitter
  - Currently supported: TypeScript, TSX, JavaScript, Python, Java, C++, C#
  - Fine-grained extraction of:
    - Classes
    - Functions
    - Methods
    - Properties
    - Variables
    - Call sites
    - File relations
    - Symbol ownership
    - Code neighborhoods
- Related code:
  - `src/analyzers/AstAnalyzer.ts`
  - `src/analyzers/ProjectAstLoader.ts`

### 4. External related files Data
- Source: an external result directory provided by the user
- Merge method: incorporated into `project-ast.json` during the project AST analysis stage
- Current relation type: `external_related`
- Role: to bring the files that are related along a file's implementation path into the base evaluation context

### 5. Thresholds and Prewarn
- Threshold configuration: `src/config/evaluation.config.ts`
- Prewarn output: `output/prewarn.json`
- Purpose: to give an early hint about behavior that is near threshold, before a Warning/Error is formally triggered

---

## II. The Current Scheme of Each of the 11 Benchmarks

## 1. Ghost Context

### Objective
- To detect large blocks of content that remain in the context but serve no substantive purpose afterwards, in particular source text still retained after summarization, non-consumable payloads, and excessively long noisy content.

### Current Signals
- The source text and the summary coexist after a `content-replacement`
- Non-consumable content such as base64, binary data, or excessively long single lines
- Whether it is referenced by text or by tool input within the following 5 steps
- Whether subsequent steps continue to touch the same code symbols, the same file neighborhood, or the same related files

### Decision Logic
- If a large block of content is still retained for a long time after summarization or replacement and is not effectively referenced by subsequent steps, it is regarded as ghost context
- If the payload itself is non-consumable noise, it also counts as waste
- For code-type content, keyword references alone are no longer decisive; if subsequent steps continue to operate on the same code neighborhood, the content is not readily judged as ghost

### Current Thresholds
- Warning: `512` tokens
- Error: `1024` tokens

### Penalty
- Warning: `0.5`
- Error: `1.5`

### False Positive Control
- If there are still subsequent references after summarization, it is not judged as waste
- Small fragments that coexist only briefly are not counted

### Remediation Direction
- Remove the source text promptly after summarization
- Summarize large objects first, then link them externally or persist them to disk

---

## 2. Oversized Rules

### Objective
- To detect `system`/rules blocks that are oversized or occupy too large a share, persistently squeezing the effective context window.

### Current Signals
- The token count of the `system` content
- The share of `system` in the cumulative context
- Whether it is the largest static context block

### Decision Logic
- Triggered when the rule volume or its share exceeds the threshold
- Both the absolute size and the relative share are taken into account

### Current Thresholds
- token Warning / Error: `2000 / 4000`
- ratio Warning / Error: `0.20 / 0.35`

### Penalty
- Warning: `0.5`
- Error: `1.5`

### False Positive Control
- A comparison against the other static blocks is made, so as to avoid misjudging a smaller but earlier-appearing `system` as oversized

### Remediation Direction
- Streamline the rules
- Link long documents externally
- Load rules on demand

---

## 3. Context Thrashing

### Objective
- To detect the reading of large objects when the window limit is nearly reached, followed shortly by compaction, so that the newly introduced information is never effectively consumed.

### Current Signals
- `context_tokens_before`
- `context_tokens_after`
- Whether compaction occurs soon after the window threshold is approached
- Whether the data read in before compaction is used afterwards
- Whether execution had already been continuing within the same code neighborhood before compaction

### Decision Logic
- When window occupancy reaches a high level and a replacement or a significant drop in tokens occurs within very few steps, this is regarded as thrashing
- Two categories are distinguished:
  - `timing_fault`
  - `payload_oversize_fault`
- If execution had already been continuing within the same file/symbol/related-files neighborhood before compaction, the payload is not regarded as "unused"

### Current Thresholds
- `windowThreshold = 0.75`
- `compressionLookAhead = 2`

### Penalty
- Warning: `1.0`

### False Positive Control
- A gradual multi-step decline does not count as compaction thrashing
- Pure output fluctuation does not count

### Remediation Direction
- Compact before reading
- Read large objects in batches
- Summarize first, then expand

---

## 4. Tool Call Chain

### Objective
- To detect excessively long consecutive invocations of the same tool, or cyclic invocations of the A→B→A kind.

### Current Signals
- The length of consecutive runs of the same tool
- Short-period cyclic patterns
- Whether the inputs are sufficiently diverse
- Whether progressive batch processing or converging search is being carried out within the same code neighborhood

### Decision Logic
- Excessively long consecutive invocations are regarded as a repetitive chain
- Short-period repeating patterns are regarded as a cyclic chain
- However, if the invocation sequence keeps making progress within the related-files neighborhood, or if the search pattern is converging, this serves as an exemption signal

### Current Thresholds
- repetitive Warning / Error: `6 / 10`
- cyclic Warning / Error: `3 / 5`

### Penalty
- Warning: `1.0`
- Error: `2.5`

### False Positive Control
- Batch-processing scenarios are exempted
- Searches/scans with high input diversity are not judged as spinning

### Remediation Direction
- Merge batch operations
- Increase retrieval granularity
- Switch strategy promptly when looping

---

## 5. Dead Step

### Objective
- To detect a step whose tool result is neither effectively referenced by the subsequent flow nor has any influence on the execution branch.

### Current Data Foundation
- Trajectory data
- File association graph
- Project AST
- External related files

### Current Signals
- Whether the textual keywords appear in subsequent inputs/plans
- Whether the AST symbols appear in subsequent steps
- Whether the file or its related files are read/written afterwards
- Whether it gives rise to a change in subsequent Agent branching

### Decision Logic
- Four kinds of check are applied to every successful tool result:
  - `noToolInputRef`
  - `noPlanRef`
  - `noFileRef`
  - `noBranchImpact`
- Number of failed checks:
  - `4/4`: Error
  - `3/4`: Warning

### Penalty
- Warning: `0.5`
- Error: `1.0`

### False Positive Control
- Indirect file references are identified with priority
- Symbol-level references are identified with priority
- `is_error` results are skipped

### Remediation Direction
- Remove the useless step
- Or make a subsequent step explicitly consume the result

---

## 6. Duplicate Step

### Objective
- To detect repeated operations on the same resource where no sufficient state change has occurred between the two occurrences.

### Current Data Foundation
- Trajectory data
- File modification times
- File association graph
- Project AST

### Current Signals
- The structural similarity of the two tool inputs
- The textual similarity of the two results
- The Jaccard overlap of the AST symbol sets
- Whether the related files changed between the two occurrences

### Decision Logic
- A duplicate is declared when either of the following conditions holds:
  - High input similarity + file unchanged + high result similarity
  - High input similarity + file unchanged + highly overlapping symbol sets
- At the same time, inherently time-varying or verification commands are exempted

### Current Thresholds
- Input structural similarity: `> 0.9`
- Result similarity: `> 0.9`
- Symbol Jaccard: `> 0.8`

### Penalty
- Warning: `0.5`
- Error: `1.5`

### False Positive Control
- Time-varying commands of the `git status` and `date` kind are exempted
- Verification commands of the `npm test` and `pytest` kind are exempted

### Remediation Direction
- Cache or reuse existing results
- Add deduplication logic for verification steps

---

## 7. Wrapper Workflow

### Objective
- To detect whether an Agent merely passes its input through to a downstream tool without providing genuine orchestration value.

### Current Data Foundation
- Agent/sidechain trajectories
- AST symbol extraction
- Project AST neighborhoods

### Current Signals
- Whether the number of internal steps is extremely small
- Whether the downstream tool type is homogeneous
- Whether the Agent input is highly similar to the downstream input
- Whether the Agent output is highly similar to the downstream output
- Whether verification logic is absent
- Whether the code scope is too narrow
- Whether the share of newly added symbols is very low

### Decision Logic
- The degree of wrapping is measured by the proportion of conditions that are satisfied
- The wrapper rate of a given Agent across multiple invocations is computed
- Only Agents with `>= 5` invocations are judged

### Current Thresholds
- Prewarn: `>= 75%`
- Warning: `>= 80%`
- Error: `>= 95%`

### Penalty
- Warning: `1.0`
- Error: `2.0`

### False Positive Control
- A small number of invocations is not included in the statistics
- When verification, aggregation, or relatively broad code coverage is present, a wrapper is not readily declared

### Remediation Direction
- Add verification, transformation, or aggregation
- When there is no added value, push the invocation down directly

---

## 8. Context Coupling

### Objective
- To detect whether the workflow contains circular dependencies, alternating invocations, or back edges that lead to severe coupling in the context structure.

### Current Signals
- Tarjan SCC
- DFS back edges
- A-B-A-B alternating patterns
- SCCs, back edges, and alternating patterns over the code neighborhood sequence

### Decision Logic
- A non-DAG structure is regarded as a coupling risk
- A small SCC may first raise a prewarn, whereas numerous alternations or back edges trigger a warning directly
- Besides the Agent/call graph, the "code context graph" is additionally checked for backflow among multiple module clusters

### Penalty
- Warning: `1.0`

### False Positive Control
- Reasonable small-scope collaboration is not penalized excessively

### Remediation Direction
- Refactor into a unidirectional data flow
- Persist/isolate the context at stage boundaries

---

## 9. Long Chain

### Objective
- To detect execution chains that are too long without sufficient task decomposition or checkpoints.

### Current Data Foundation
- Trajectory data
- Project AST
- File neighborhoods and symbol sets

### Current Signals
- The total number of steps
- The number of explicit subtasks
- The number of explicit checkpoints
- Structured subtasks
- Structured checkpoints

### Decision Logic
- Effective chain length:
  - `Leff = L / (1 + Nsub + Nckpt)`
- Subtasks comprise two kinds:
  - Explicit subtasks: Agent / sidechain
  - Implicit subtasks: the code focus shifts to a new module cluster
- Checkpoints comprise two kinds:
  - Explicit checkpoints: user messages, explicit test steps
  - Implicit checkpoints: verification of, or re-reading of, the same code cluster after a modification

### Current Thresholds
- effective length Warning / Error: `12 / 20`
- simple Warning / Error: `25 / 40`

### Penalty
- Warning: `1.0`
- Error: `2.5`

### False Positive Control
- Implicit stage boundaries are identified through the project AST, so as to avoid misjudging an execution chain that has in fact already been staged as a long chain

### Remediation Direction
- Introduce subtasks
- Add verification after critical modifications
- Use staged checkpoints to segment the chain

---

## 10. Interface Inconsistency

### Objective
- To detect functionally similar tools that are inconsistent in their input/output structures, or whose usage boundaries are unclear.

### Current Data Foundation
- Tool invocation inputs
- Tool result contents
- AST result shapes
- Project AST code neighborhoods

### Current Signals
- Differences between the sets of parameter names
- Differences in parameter types
- Differences in result shape:
  - `text`
  - `json_like`
  - `json_text`
  - `code_like`
  - `path_like`
- Differences in the distribution of returned symbol types
- The overlap of the file neighborhoods on which the tools of the same group act
- Tool usage dispersion

### Decision Logic
- Two kinds of analysis are carried out on tool clusters:
  - schema difference
  - semantic overlap
- When the semantic overlap is high but the schema difference is also high, the risk is greater
- Dispersion is also semantically corrected:
  - If the project AST shows that these tools in fact act on the same code region, a high dispersion is more likely to indicate unclear interface design
  - If no project AST is available, fall back to the original statistical criterion

### Current Thresholds
- interface risk Warning / Error: `> 0.4 / > 0.7`
- dispersion Warning: `> 0.8`

### Penalty
- Warning: `1.0`
- Error: `2.0`

### False Positive Control
- When no project AST is available, the newly added semantic factor is not used, so as not to disturb the original baseline
- A natural division of labor across different code domains should, as far as possible, not be misjudged as an inconsistent tool interface

### Remediation Direction
- Unify parameter naming
- Unify result structures
- Clarify tool boundaries

---

## 11. Weak Tool

### Objective
- To detect tools whose invocation rate is low in the very scenarios where they ought to apply, which indicates poor discoverability or substitution by other tools.

### Current Signals
- The inferred task type
- The total number of applicable tasks
- The actual number of invocations
- The invocation of substitute tools
- The file neighborhoods reached by the tool, the number of symbols, and the related-files coverage

### Decision Logic
- The task type is first inferred from the tool usage pattern:
  - File search
  - Code search
  - File reading
  - File modification
  - Command execution
  - Subtask delegation
  - web search / fetch
- For each tool, compute:
  - `callRate = actualCallCount / suitableTaskCount`
- Task opportunities are no longer inferred solely from tool names; multi-file related modifications, cross-neighborhood operations, and symbol-dense results also increase the corresponding tool's "opportunities on which it ought to have been invoked"

### Current Thresholds
- Warning: `callRate < 0.30`
- Error: `callRate < 0.15`
- Near-threshold prewarn: `0.30 - 0.35`

### Penalty
- Warning: `1.0`
- Error: `2.0`

### False Positive Control
- Statistics are computed only when the number of applicable tasks is sufficiently large
- Whether the tool is largely covered by substitute tools is also taken into account

### Remediation Direction
- Improve the tool descriptions
- Add examples
- Actively hint at the use of the tool in the applicable scenarios

---

## III. The Relationship Between the Current 11 Benchmarks and the AST

### Benchmarks Strongly Dependent on the AST / Project Relations
- Dead Step
- Duplicate Step
- Wrapper Workflow
- Long Chain
- Interface Inconsistency

### Benchmarks That Rely Mainly on Behavioral or Contextual Statistics
- Ghost Context
- Oversized Rules
- Context Thrashing
- Tool Call Chain
- Context Coupling
- Weak Tool

Context Chain enhancement:
- The current implementation has already introduced the [ContextChainAnalyzer](./src/analyzers/ContextChainAnalyzer.ts), which recovers the true context chain of each step directly from `parentUuid`.
- `Ghost Context`, `Dead Step`, and `Context Thrashing` no longer rely solely on the coarse-grained approximations of "looking N steps forward in time" or "accumulating all historical tokens"; instead they give priority to the true ancestor chain / descendant chain when judging context occupancy and reuse.
- This reduces the interference of branch switching, sibling messages, and unrelated subsequent chatter on the benchmark results.

Notes:
- Not every benchmark needs to be forcibly wired to the AST.
- The current policy is as follows: the AST is wired in only when it significantly improves the judgment quality of "whether a genuine code association, symbol association, module switch, or code neighborhood consistency has actually occurred".

---

## IV. Current Configuration and Output Entry Points

### Configuration File
- [config/project-analysis.config.json](./config/project-analysis.config.json)

### Key Outputs
- [file-graph.json](./output/file-graph.json)
- [project-ast.json](./output/project-ast.json)
- [prewarn.json](./output/prewarn.json)

### Related Documents
- [benchmark_specs.md](./docs/benchmark_specs.md)
- [benchmark_evaluation_guide.md](./docs/benchmark_evaluation_guide.md)

---

## V. Recommended Follow-Up Reinforcements

- Wire the project AST into `WeakTool`, so as to upgrade the determination of "applicable tasks" from purely tool-pattern inference to code-relation opportunity identification.
- Add sample inputs / sample issue outputs for each detector, forming a benchmark case document that can be directly re-verified.
- Add a "base version / AST-enhanced version" signal comparison table for the 11 benchmarks, so as to facilitate version documentation.
