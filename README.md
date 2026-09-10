# ProcCtrlBench

Reference implementation for **ProcCtrlBench: Evaluating Process-Level Defects and Control
Preservation in LLM Coding Agents**.

Most coding-agent benchmarks score the final state: did the task pass, did the tests go green.
ProcCtrlBench scores the *execution process* instead. It normalises heterogeneous agent logs into a
common trajectory representation, extracts evidence for 11 recurring execution defects across 4
dimensions, maps that evidence to calibrated posterior risk, and reports a scorecard that includes
**control preservation** — whether the run stayed interpretable, interruptible, correctable,
reversible, and able to hand authority back.

## Status of the data

This repository contains the **implementation**. It does not ship the paper's trajectory corpus or
its 200-case process-level annotation set; `output/` and `external_data/` are git-ignored.

Artifacts that need data you don't have are reported as **blocked**, with the specific missing input
named. The pipeline never substitutes placeholder values for annotation-dependent numbers. See
[docs/reproducing_paper_results.md](docs/reproducing_paper_results.md) for exactly which tables and
figures need what.

## Install

```bash
npm install
npm run build
npm test
```

Requires Node 18+. Native `tree-sitter` grammars are used for AST-aware detectors; set
`PROC_BENCH_DISABLE_TREE_SITTER=1` to skip them if the native build is unavailable.

## Quick start

Evaluate a single agent session:

```typescript
import { AgentEvaluator } from './src/AgentEvaluator';

const evaluator = await AgentEvaluator.fromJsonlFile('path/to/session.jsonl');
const report = await evaluator.evaluate();

console.log(report.findings);             // per-defect evidence + posterior risk
console.log(report.risk.overallRisk);
console.log(report.controlPreservation);  // CP score and its five subdimensions
```

Or run the bundled example: `npm run example`.

Evaluate a whole benchmark corpus and then build the paper tables:

```bash
# 1. one run per agent-model configuration, each with a distinct --variant
npm run paper:evaluate -- \
  --terminal-root /path/to/terminal-bench/runs \
  --output output/runs/system-a \
  --variant "Claude Code / Sonnet 4.6"

# 2. assemble tables and figures across all runs
npm run paper:artifacts -- \
  --records output/runs/system-a/trajectory-records.jsonl \
  --annotations path/to/annotations.json \
  --output output/paper-artifacts
```

Step 2 writes one CSV per table/figure plus `artifact-manifest.md`, which states per artifact whether
it was generated or blocked and records the scoring configuration used.

## The defect ontology

11 defect classes in 4 dimensions. Definitions and boundary conditions are in Appendix A of the
paper; the machine-readable taxonomy is `PROCCTRL_TAXONOMY` in
[src/benchmark/ProcCtrlScorecard.ts](src/benchmark/ProcCtrlScorecard.ts).

| Dimension | Defects |
|---|---|
| Context Management (`Qctx`) | Ghost Context, Oversized Rules, Context Window Thrashing |
| Tool-Use Efficiency (`Qtool`) | Duplicate Step, Tool Call Chain, Dead Step, Long Chain |
| Workflow Architecture (`Qwf`) | Wrapper Workflow, Context Coupling |
| Tool-Ecosystem Consistency (`Qeco`) | Inconsistent Tool Interface, Weak Tool |

Each detector emits a **continuous** evidence score, because most process defects are matters of
degree. Binary activation is an intermediate interpretation layer, gated by exemption rules: a
pattern that superficially matches a defect but is appropriate under the task context is exempt, not
defective.

## Scoring

```
p_j   = P(defect j present | evidence, task context)     calibrated posterior risk
Q_d   = 1 - mean over the defects of dimension d of p_j  dimension process quality
Qdef  = weighted mean of the four Q_d
CP    = control preservation, from five subdimensions
PB    = eta * Qdef + (1 - eta) * CP
```

`PB` is a coarse summary for ranking; the full scorecard is the primary output. `eta` defaults to
`0.5` — the paper does not fix it, and Figure 8 sweeps the whole range.

Severity bands (`none` / `warning` / `error`) are reporting aids over calibrated risk, not the score
itself. Per-trajectory reports deliberately expose no single quality score: aggregation to `PB`
happens only in the scorecard layer, where cross-system comparison is the point.

**Fragile success** is an endpoint success that nonetheless shows weak process control — CP below an
absolute threshold, or at least one error-level finding. The threshold is absolute by design; a
dataset-relative one would not be comparable across systems.

## Repository layout

```text
src/
  analyzers/        log normalisation (Psi), AST, similarity, context-chain analysis
  detectors/        the 11 defect detectors
  evaluators/       per-dimension evaluators
  scoring/          report assembly (findings, risk, control preservation, guidance)
  benchmark/        ProcCtrlScorecard, PaperMetrics, PaperArtifacts, statistics
  adapters/         benchmark trajectory loaders, annotation loader
scripts/            evaluation and artifact-generation entry points
docs/               protocol and reproduction documentation
tools/              Claude Code runtime-guard sidecar (see below)
tests/runtime-guard/ unit tests, run by `npm test`
```

## Documentation

- [docs/reproducing_paper_results.md](docs/reproducing_paper_results.md) — paper artifact map, CLI
  options, and the exact scoring definitions as implemented.
- [docs/annotation_protocol.md](docs/annotation_protocol.md) — annotation format, the three-valued
  judgment, adjudication, and the 80/40/80 split.
- [docs/metrics.md](docs/metrics.md), [docs/benchmark_specs.md](docs/benchmark_specs.md) — detector
  specifications.
- [QUICKSTART.md](QUICKSTART.md), [USAGE_GUIDE.md](USAGE_GUIDE.md) — usage walkthroughs.

## Runtime guard (exploratory)

`tools/claude-code-runtime-guard/` is a sidecar that runs the same defect logic live during a Claude
Code session and surfaces warnings and correction hints. This is the "execution-time governance" use
mentioned in the paper as illustrative; it is **not** part of the benchmark definition. See
[docs/claude_code_runtime_guard.md](docs/claude_code_runtime_guard.md).

## Configuration

`config/benchmark-model.config.yaml` and `config/project-analysis.config.json` ship with
placeholders only. Supply your own endpoint, credentials, and dataset paths — via environment
variables (`PROCCTRL_API_KEY`, `PROCCTRL_ANDROID_BENCH_REPO`, `PROCCTRL_SWEBENCH_PROJECTS_ROOT`, …)
rather than by committing them.

## License

MIT — see [LICENSE](LICENSE).
