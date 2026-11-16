# Methodology for the 11 Evaluation Benchmarks (Process-Risk-Enhanced Edition)

Targeting the 11 benchmarks Ghost/Wrapper/Oversized/Thrashing/ToolChain/Coupling/Interface/Weak/Dead/Duplicate/Long, combining:
- AST (tree-sitter, JS/TS first) → symbol-level references such as classes / functions / methods / imports
- file association graph (produced by an external script) → the set of core associated files A(f)
- trajectory events (messages/toolUses/toolResults/replacements/usage) → reproducible evidence
- finding standardization → detector score / posterior risk / risk severity
- control preservation analysis → interpretability / interruptibility / corrigibility / reversibility / handoff awareness
- execution guidance → summarize-context / checkpoint / verify / confirmation / handoff

Common variables:
- F: the set of files; A(f): the set of core associated files of f; Sym(f): the symbol set of f
- τ: the execution trajectory; U_t: context tokens used; W: window size; Δ_t: the payload of a given step
- reference decision Ref(x→y): a symbol (or file) of x appears in the input / plan / file operation of y, or A(x) intersects the operation target of y

## 1. Ghost Context
- Phenomenon: after summary replacement, the source text is still retained for ≥L steps; or an unconsumable payload (base64 / binary / excessively long single line) ≥T.
- Metric: G = Σ(|orig|-|summary|)_+ / Σ|context|
- Evidence: replacements + token estimation + absence of Ref(source text → subsequent k steps)
- Decision: G≥g_warn (Warning), G≥g_err (Error); window prewarn threshold 0.75 (compact in advance)

## 2. Wrapper Workflow
- Phenomenon: the agent passes the input straight through to a single tool type, without constraining / aggregating / validating / rewriting it.
- Metric: wrapper rate = the proportion of calls satisfying {≤1 internal step, single tool type, high input/output similarity, no verification}
- Evidence: no newly added symbols in the AST; high symbol overlap between downstream and upstream (Jaccard≥0.8), and a unique tool type

## 3. Oversized Rules
- Phenomenon: the system rules are oversized or occupy too large a share.
- Metric: Rs (system tokens), r=Rs/total; whether it is the largest static block
- Decision: dual thresholds; accompanied by "largest static content" evidence

## 4. Context Thrashing
- Phenomenon: compaction within a few steps after loading.
- Metric: Θ=Δ_t/(W-U_{t^-}); look-ahead=2
- Classification: timing fault (compaction still late while near the threshold); oversize fault (a single payload is too large).
- Recommendation: use AST + graph to assess file size → summarize in advance; or run repomix first and read afterwards

## 5. Tool Call Chain
- Phenomenon: excessively many consecutive calls to the same-named tool; or a cyclic pattern A→B→A→...
- Metric: C (consecutive count), (p,q) (pattern length / number of repeated rounds), sequence entropy H_seq
- Evidence: inject a prewarn message when near the threshold; exempt batch processing / diverse inputs / convergent search

## 6. Context Coupling
- Phenomenon: non-hierarchical interleaved dependencies; SCC / alternating patterns / back edges.
- Metric: C_scc=Σ(|SCC|-1)/|V|
- Evidence: call graph + event chronology; report the coupling type and its count

## 7. Interface Inconsistency
- Phenomenon: interface divergence among functionally similar tools; dispersed usage across repeated trials.
- Metric: D (Jaccard + type inconsistency rate); dispersion Ĥ (normalized entropy)
- Evidence: significance across trial groups (Bootstrap / paired t-test)

## 8. Weak Tool
- Phenomenon: a low call rate in applicable scenarios; alternative tools used extensively.
- Metric: α=A/S; substitution ratio; significance of the difference before and after the mutation-augmentation experiment

## 9. Dead Step
- Phenomenon: the result is neither referenced afterwards nor influences any decision.
- AST enhancement: parse the symbol set Sym(result) from the result and look up Ref in the inputs / plans / file operations / branch changes of the subsequent k steps; if there is no intersection at file level but A(f)∩target≠∅, this also counts as an indirect reference.
- Evidence: failure count f≥3 (Warning), f=4 (Error); provide symbol- and file-level evidence slices

## 10. Duplicate Step
- Phenomenon: the same tool, highly similar inputs / results, and no state change during the interval.
- AST enhancement: compare the input structure and the symbol overlap of the results to confirm semantic duplication; if A(f) received no writes during the interval, the duplication judgment is stronger.

## 11. Long Chain
- Phenomenon: the execution chain is overly long and lacks subtasks / checkpoints.
- Metric: L_eff = L / (1+N_sub+N_ckpt); use a simple threshold when there are no subtasks
- Evidence: record the correlation between repeated compaction and the failure rate, supporting a causal hint (overly long chain → higher failure rate)

## Statistics and Reproduction
- Repeated trials (≥5 per task): report mean ±95% CI; paired tests and effect-size reporting.
- Reproduction materials: random seeds, version stamps, dependency hashes, trajectory snapshots.

## Risk and Control Preservation

- A detector first outputs an issue, which is then standardized into a finding.
- A finding contains at least: `metric`, `dimension`, `detectorScore`, `posteriorRisk`, `riskSeverity`, `conditionSignals`.
- The `posteriorRisk` implemented in the current repository is `heuristic-bayesian-proxy`:
  - it uses empirical priors over defect types
  - it combines detector severity, evidence strength, and the detector score
  - it reports more stable warning / error risk semantics
- `controlPreservation` is not directly equivalent to the number of issues; rather, it acts as a supplementary independent dimension:
  - `interpretability`
  - `interruptibility`
  - `corrigibility`
  - `reversibility`
  - `handoffAwareness`
- `executionGuidance` uses `overallRisk` together with `controlPreservation.score` to jointly determine the strength of autonomy adjustment.

## Implementation and Integration
- AST: `src/analyzers/AstAnalyzer.ts` (tree-sitter, with regex degradation)
- File graph: `src/analyzers/FileAssociationLoader.ts` (reads external JSON)
- Aggregation: `src/benchmark/BenchmarkRunner.ts` (Bootstrap CI)
- Graph generation command (example):
  `npx tsx '~/Desktop/ACoder/scripts/analyze-files.ts' ~/Desktop/ACoder/scripts/analyze-files-example.json`
- It is recommended to store the generated JSON at `output/file-graph.json` and to declare the path in the evaluation configuration.
