# The Claude Code Runtime Guard Design

This document presents the design of a runtime component that sits outside the current main evaluation pipeline. The goal is not to perform an offline evaluation once a task has finished, but rather to carry out real-time monitoring, prewarning, and in-process correction for the 11 benchmarks directly during the execution of the Claude Code CLI, on the basis of the incremental `jsonl` transcript, the project AST, and the related-files graph.

## 1. Design Goals

- Independent deployment:
  - Does not intrude into the current main evaluation logic under `src/`
  - Can be started and stopped separately as a sidecar / wrapper component
- One-click embedding:
  - Integrated by way of Claude Code hooks + transcript tailing
  - Does not require modifying the internal source code of Claude Code
- Configurability:
  - Each of the 11 benchmarks can be toggled individually
  - Every benchmark has its own independent policy, thresholds, and action level
- Low coupling:
  - The AST, the related files, and the execution trajectory are decoupled from one another
  - Allows enabling only the trajectory rules, without mandating a dependency on full project analysis
- Controllable intervention:
  - Supports four modes: observation only, warning, hinting before blocking, and automatic injection of corrective suggestions

## 2. Component Layout

It is recommended that the component be implemented as a standalone directory, for example:

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

Within the current repository, the component boundary can first be defined by means of documentation and configuration templates, and later be extracted into a separate repository or npm package.

## 3. How to Integrate with the Claude Code CLI

Claude Code itself exhibits two key properties that make it well suited to integrating this component:

- The transcript is an incrementally appended `jsonl` file
- The hooks payload gives access to `session_id`, `transcript_path`, and `cwd`

A "dual-channel integration" is therefore recommended:

### 3.1 Channel A: Low-Latency Interception via hooks

Used to trigger the guard logic immediately before and after critical actions:

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse`
- `PostToolUse`
- `SubagentStart`
- `SubagentStop`
- `PreCompact`
- `Stop`

The purpose of the hooks is not to reconstruct the full history, but rather to:

- Send the guard process highly timely events describing "what is happening right now"
- Perform a "pre-blocking check" at the `PreToolUse` stage
- Perform a context quality assessment at the `PreCompact` stage

### 3.2 Channel B: Ground-Truth Replay via transcript tailing

The information provided by the hooks is incomplete, so the transcript must ultimately remain the source of truth. The sidecar continuously tails the `jsonl` file in order to:

- Read the most recently appended events
- Build up the session state incrementally
- Reconcile against the hook events
- Perform cross-step detection, window detection, and periodicity detection

This resolves two problems:

- The hooks can only see the current action, not the complete chain
- The Claude Code runtime context is not a simple equivalent of the transcript; an "effective context approximation" has to be reconstructed from the event stream

## 4. Internal Architecture of the Guard Component

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

Responsibilities:

- Watch the main transcript and the subagent transcripts
- Read new lines incrementally by offset
- Parse the events and normalize them into an internal event stream

### 4.2 Session State Store

Maintains the minimal state required at runtime:

- The most recent N steps of messages
- The current tool invocation chain
- The files already read, the files already written, and the symbols already modified
- The current task cluster / subtask cluster
- The most recent compaction boundary
- The current set of candidate context
- The most recent prewarn and its suppression window

### 4.3 AST Context Provider

Inputs:

- The project AST
- The currently active file
- The paths, symbols, and line numbers in the current tool parameters

Outputs:

- The file neighborhood
- related symbols
- The read/write coverage
- Call-site / definition-site relations

### 4.4 Related Files Provider

Incorporates the external related files results into the code neighborhood judgment. Its role is not to replace the AST, but to make up for those implementation paths that are hard to recover statically within the AST.

### 4.5 Remediation Engine

Rather than modifying Claude Code's internal context directly, it emits corrective actions that can be consumed:

- Console hints
- hook stderr warnings
- Generation of a sidecar suggestion file
- Injection of a hint for the next round by way of the user message injector
- Return of a blocking opinion at the `PreToolUse` stage

## 5. Intervention Levels

A uniform four-level scheme is recommended:

- `observe`
  - Records only, gives no hints
- `warn`
  - Emits a warning without blocking
- `guard`
  - Gives advice before a high-risk step and requires confirmation
- `remediate`
  - Automatically generates a corrective hint or an alternative execution suggestion

## 6. Runtime Solutions for the 11 Benchmarks

The design below is organized as "detection timing + defect signals + in-process actions".

## 6.1 Ghost Context

### Detection Timing

- `PostToolUse`
- `PreCompact`
- After a large payload / replacement / summary appears in the transcript

### Defect Signals

- A large block of content is introduced and then not consumed within the following 3 to 5 steps
- The summary and the source text coexist for too long
- base64 / large JSON / long logs that have not been distilled into a structured form
- A large block of code is read in, but no related symbols or related files are touched thereafter

### In-Process Actions

- `warn`:
  - Hint that "the current large block of content has not yet been consumed; consider summarizing before continuing"
- `guard`:
  - Before the next read of a large file, hint that one should "first use Grep / symbol search to narrow the scope"
- `remediate`:
  - Automatically inject a corrective suggestion:
    - "Please first summarize the effective conclusions of the preceding payload, and retain only the information that is directly relevant to the target file/symbol"

### Avoidance Objective

- Reduce the retention of ineffective large context
- Reduce the quality loss of the subsequent compact

## 6.2 Oversized Rules

### Detection Timing

- `SessionStart`
- Before the first round of assistant output
- `PreCompact`

### Defect Signals

- The absolute volume of the system / appended rules is too large
- The rules account for too large a share of the current context
- The rules have already become the largest static block

### In-Process Actions

- `warn`:
  - Report the token share of the rules
- `guard`:
  - Hint that one should switch to "minimal rules + external document references"
- `remediate`:
  - Automatically generate a compressed rule summary file
  - Turn long rules into reference hints, rather than repeatedly injecting the full text

### Avoidance Objective

- Prevent the rules from crowding out the execution-time context

## 6.3 Context Thrashing

### Detection Timing

- `PreToolUse`, before a large file is read
- `PreCompact`
- The transcript reveals a large volume of reading followed by compaction within a short period

### Defect Signals

- Large objects continue to be read even though the window is already close to the threshold
- A compact / replacement occurs after only 1 to 2 steps
- The information introduced before compaction is not used thereafter

### In-Process Actions

- `warn`:
  - Report that "the large object about to be read in will very likely be compacted straight away"
- `guard`:
  - Intercept `Read` / `Glob` / large log reads and require that the scope be narrowed first
- `remediate`:
  - Automatically suggest alternative strategies:
    - Use Grep / symbol search first
    - Read only the matching segments
    - Summarize the preceding context first, then expand with the new object

### Avoidance Objective

- Avoid "reading and then discarding"

## 6.4 Tool Call Chain

### Detection Timing

- Every `PostToolUse`

### Defect Signals

- Consecutive invocations of the same tool run on too long
- A->B->A / A->B->A->B cycles appear
- The differences between the inputs are very small, and there is no progress in the code neighborhood

### In-Process Actions

- `warn`:
  - Hint that "the consecutive tool chain is too long; consider merging it into batch processing"
- `guard`:
  - Block the next invocation of a tool of the same kind once the error threshold is reached
- `remediate`:
  - Generate an alternative plan:
    - Perform a batch grep first, then read in a consolidated manner
    - Locate the target symbol first, then operate on it
    - Move from searching to verifying

### Avoidance Objective

- Avoid inefficient spinning chains

## 6.5 Dead Step

### Detection Timing

- After a given tool returns successfully, look ahead over the following 3 to 5 steps

### Defect Signals

- The tool result is not referenced by any subsequent input
- It does not enter the subsequent plan text
- It gives rise to no action in the file/symbol/related-files neighborhood
- It produces no branch change
- `Write` is never judged to be a dead step

### In-Process Actions

- `warn`:
  - Tag those results that have just been completed but have not yet been consumed
- `guard`:
  - When dead step candidates occur consecutively, prevent further blind reads of the same kind
- `remediate`:
  - Automatic hint:
    - "Please first explain the bearing of the preceding tool result on the current problem, and only then decide on the next step"

### Avoidance Objective

- Force every read / search result into the subsequent decision chain

## 6.6 Duplicate Step

### Detection Timing

- Before a new tool invocation, compare it against the most recent steps of the same kind

### Defect Signals

- The inputs are highly similar
- No relevant file changed in between
- The output summaries are highly similar
- The same AST symbol set is hit

### In-Process Actions

- `warn`:
  - Mark it as a "duplicate operation candidate"
- `guard`:
  - On the second repetition, require an explanation of the reason for repeating
- `remediate`:
  - Automatically put forward a better action:
    - Use the cached result
    - Proceed directly to modification / verification
    - Broaden the target scope rather than repeatedly reading the same point

### Avoidance Objective

- Reduce repeated reading, repeated searching, and repeated execution

## 6.7 Wrapper Workflow

### Detection Timing

- After a subagent / agent tool completes
- `SubagentStop`

### Defect Signals

- The agent merely performs a simple pass-through
- The downstream tool type is homogeneous
- The input and the output are highly similar
- There is no transformation, verification, or aggregation
- A low symbol increment

### In-Process Actions

- `warn`:
  - Report that "the current agent looks more like a wrapper layer"
- `guard`:
  - Restrict the further derivation of new subagents for this pattern
- `remediate`:
  - Hint that the simple wrapping logic should be folded back into the main thread
  - Or require the agent to take responsibility for clear subtask boundaries and verification criteria

### Avoidance Objective

- Avoid hollow agents that merely add layers of invocation

## 6.8 Context Coupling

### Detection Timing

- Update the call graph after each round of messages
- `SubagentStop`

### Defect Signals

- The main thread and multiple subagents switch back and forth frequently within the same code neighborhood
- A strong SCC appears in the call graph
- Back edges are frequent
- Context is shuttled back and forth among multiple workers

### In-Process Actions

- `warn`:
  - Hint that "the current task cluster is too tightly coupled; consider splitting its boundaries"
- `guard`:
  - Before creating a new subagent, assess whether it conflicts with the write set of an existing worker
- `remediate`:
  - Automatic suggestions:
    - Split by file cluster
    - Split by symbol ownership
    - Complete a local closed loop before switching threads

### Avoidance Objective

- Control the context backflow between the main thread and the branch threads

## 6.9 Long Chain

### Detection Timing

- Assess the length of the current task chain at the end of each round

### Defect Signals

- Too many steps
- No explicit checkpoint
- No explicit subtask closed loop
- Wandering back and forth across too many file clusters for one and the same problem

### In-Process Actions

- `warn`:
  - Remind the model to establish a checkpoint
- `guard`:
  - Once the threshold is reached, require a summary before continuing
- `remediate`:
  - Automatically inject:
    - The items completed so far
    - The items not yet completed
    - The constraint that the next step may focus on one sub-problem only

### Avoidance Objective

- Prevent unbounded exploration chains

## 6.10 Inconsistent Tool Interface

### Detection Timing

- `SessionStart`
- After the initial tool registration completes
- When a new tool is invoked for the first time

### Defect Signals

- Semantically similar tools have inconsistent interfaces
- The parameter naming and the result shapes differ too widely
- Read/write tools of the same kind return non-uniform structures

### In-Process Actions

- `warn`:
  - Emit an interface risk summary
- `guard`:
  - Require an explicit parameter mapping when switching between high-risk tools
- `remediate`:
  - Generate a canonical adapter layer:
    - Unify the path field
    - Unify the result schema
    - Unify the success/error envelope

### Avoidance Objective

- Reduce the misuse that arises when the model faces inconsistent tool interfaces

## 6.11 Weak Tool

### Detection Timing

- `SessionStart`
- After each switch of the task cluster

### Defect Signals

- A more applicable tool plainly exists, yet goes unused over a long period
- Reading large files in place of using the search tools
- Manual traversal in place of AST / grep / structured tools

### In-Process Actions

- `warn`:
  - Hint that "a stronger candidate tool exists"
- `guard`:
  - When the inefficient substitution pattern keeps recurring, block any further weak tool path
- `remediate`:
  - Automatically suggest the most suitable alternative tool
  - Provide an invocation template

### Avoidance Objective

- Raise tool selection from "usable" to "a better fit"

## 7. Configuration File Design

Core requirements:

- Uniform control by a global mode
- Each of the 11 benchmarks can be toggled individually
- Every one of them can be configured with thresholds, an action level, and a cooldown window

Recommended configuration items:

- `enabled`
- `mode`
- `thresholds`
- `actions`
- `cooldownSteps`
- `injectPrompt`
- `blockOnError`

For the concrete template, see:

- [tools/claude-code-runtime-guard/guard.config.example.json](./tools/claude-code-runtime-guard/guard.config.example.json)

## 8. One-Click Embedding

The current repository already provides integration scripts that can be used directly:

- [bin/claude-with-guard](./tools/claude-code-runtime-guard/bin/claude-with-guard)
- [bin/cc-guard-hook](./tools/claude-code-runtime-guard/bin/cc-guard-hook)

It is recommended to install the hooks first:

```bash
./tools/claude-code-runtime-guard/bin/claude-with-guard \
  --config ./tools/claude-code-runtime-guard/guard.config.example.json \
  --install-only
```

This merges the hooks into the current project's `.claude/settings.local.json`, and also copies the guard configuration file that was passed in into the current project's `.claude/` directory. Subsequent hooks will read this in-project copy of the configuration with priority, which prevents concurrent projects from sharing one and the same configuration file.

Thereafter, simply use:

```bash
./tools/claude-code-runtime-guard/bin/claude-with-guard \
  --config ./tools/claude-code-runtime-guard/guard.config.example.json
```

Execution flow:

1. The wrapper copies the guard configuration into the target project's `.claude/` directory, and merges the Claude hooks configuration into place
2. The Claude Code CLI starts up as usual
3. Claude triggers the hooks on events such as `SessionStart` / `PreToolUse` / `PostToolUse` / `PreCompact`
4. The hook passes the payload to `cc-guard-hook`
5. `cc-guard-hook` invokes the runtime guard engine
6. The engine reads the transcript and runs the 11 benchmarks
7. The hook returns:
   - `systemMessage`
   - `hookSpecificOutput.additionalContext`
   - `permissionDecision=deny` (for a high-risk `PreToolUse`)

## 9. Minimum Viable Implementation Order

A three-phase plan is recommended:

### Phase 1

- transcript tailing
- SessionStart / PreToolUse / PostToolUse / PreCompact hooks
- Land the 5 highest-return benchmarks first:
  - Ghost Context
  - Context Thrashing
  - Tool Call Chain
  - Dead Step
  - Duplicate Step

### Phase 2

- subagent relations
- Context Coupling
- Wrapper Workflow
- Long Chain

### Phase 3

- Tool interface modeling
- Inconsistent Tool Interface
- Weak Tool
- Automatic remediation injection

## 10. Recommended Outputs

It is recommended that the sidecar emit three kinds of artifact:

- `alerts/<session_id>.jsonl`
  - The individual warnings
- `state/<session_id>.json`
  - The current guard state
- `remediation/<session_id>.md`
  - The corrective suggestions that can be injected

## 11. Conclusion

For the Claude Code CLI, the most robust way to land this is not to modify the internal source code, but rather to:

- Use the hooks to obtain "the present moment"
- Use transcript tailing to obtain "the global history"
- Use the AST + related files to supplement "the code semantic neighborhood"
- Use the 11 benchmarks to drive real-time warnings and lightweight intervention

What this yields is a runtime defect protection component that is genuinely independent, embeddable with one click, toggleable item by item, and able to evolve continuously.
