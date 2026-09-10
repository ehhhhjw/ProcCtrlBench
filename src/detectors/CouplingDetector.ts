import { SessionData, ToolUseInfo } from '../../ClaudeCodeStructure/src/types';
import { IDetector, DetectionIssue, Severity, EvaluationConfig } from '../types/evaluation.types';
import { ContextCouplingInfo } from '../types/metrics.types';
import { AstAnalyzer } from '../analyzers/AstAnalyzer';
import { ProjectAstLoader } from '../analyzers/ProjectAstLoader';
import { CodeContextAnalyzer, CodeFootprint } from '../analyzers/CodeContextAnalyzer';
import { writePrewarn } from '../utils/Prewarn';
import { finalizeDetectorIssues } from './detector-calibration';

/**
 * Context coupling detector
 * Detects interleaved dependencies among Tools/skills/agents instead of a clear hierarchical structure
 */
export class CouplingDetector implements IDetector {
  readonly name = 'CouplingDetector';
  private sessionData: SessionData;
  private config: EvaluationConfig;
  private ast?: AstAnalyzer;
  private projectAst?: ProjectAstLoader;
  private codeContext: CodeContextAnalyzer;

  constructor(sessionData: SessionData, config: EvaluationConfig) {
    this.sessionData = sessionData;
    this.config = config;
    this.ast = new AstAnalyzer();
    this.ast.init().catch(() => { /* optional */ });
    try {
      const projectAstPath = require('path').join(process.cwd(), 'output/project-ast.json');
      this.projectAst = new ProjectAstLoader(projectAstPath);
      this.projectAst.load();
    } catch (e) {
      this.projectAst = undefined;
    }
    this.codeContext = new CodeContextAnalyzer(this.sessionData, this.ast, this.projectAst);
  }

  async detect(): Promise<DetectionIssue[]> {
    const issues: DetectionIssue[] = [];

    // Build the call graph
    const callGraph = this.buildCallGraph();
    const contextSequence = this.buildContextSequence();
    const contextGraph = this.buildContextGraph(contextSequence);

    // Detect strongly connected components (Strongly Connected Components)
    const sccs = this.findStronglyConnectedComponents(callGraph);
    const contextSccs = this.findStronglyConnectedComponents(contextGraph);

    for (const scc of sccs) {
      if (scc.length >= 2) {
        // Circular dependency found
        if (scc.length === 2) {
          writePrewarn({
            metric: 'contextCoupling',
            message: `Detected a small SCC (possible circular dependency): ${scc.join(' ↔ ')}`,
            details: { components: scc },
          });
        }
        issues.push({
          metric: 'contextCoupling',
          severity: Severity.Warning,
          message: `Detected context coupling: ${scc.length} components form a circular dependency [${scc.join(' ↔ ')}]`,
          location: {},
          suggestion: `Refactor the workflow into a clear hierarchical structure. Consider using unidirectional data flow to avoid circular invocations`,
          evidence: {
            type: 'medium',
            details: {
              type: 'scc',
              components: [scc],
              size: scc.length,
            },
          },
          deduction: 1.0,
        });
      }
    }

    for (const scc of contextSccs) {
      if (scc.length >= 2) {
        issues.push({
          metric: 'contextCoupling',
          severity: Severity.Warning,
          message: `Detected code context coupling: ${scc.length} code neighborhoods repeatedly depend on each other [${scc.join(' ↔ ')}]`,
          location: {},
          suggestion: `Code-related steps switch back and forth among multiple module clusters. Consider executing in phases grouped by code neighborhood to avoid repeated context thrashing`,
          evidence: {
            type: 'medium',
            details: {
              type: 'scc',
              components: [scc],
              scope: 'code_context',
            },
          },
          deduction: 1.0,
        });
      }
    }

    // Detect alternating invocation patterns
    const alternatingPatterns = this.detectAlternatingCalls(callGraph);
    const alternatingContexts = this.detectAlternatingContexts(contextSequence);

    for (const pattern of alternatingPatterns) {
      if (pattern.count >= 4) {
        issues.push({
          metric: 'contextCoupling',
          severity: Severity.Warning,
          message: `Detected alternating invocation pattern: ${pattern.pattern.join(' ⟷ ')} repeated ${pattern.count} times`,
          location: {},
          suggestion: `Avoid alternating invocations such as A→B→A→B. Consider merging the logic or redesigning the interface`,
          evidence: {
            type: 'medium',
            details: {
              type: 'alternating_pattern',
              pattern: pattern.pattern,
              patternCount: pattern.count,
            },
          },
          deduction: 1.0,
        });
      }
    }

    for (const pattern of alternatingContexts) {
      if (pattern.count >= 3) {
        issues.push({
          metric: 'contextCoupling',
          severity: Severity.Warning,
          message: `Detected code context alternation: ${pattern.pattern.join(' ⟷ ')} repeated ${pattern.count} times`,
          location: {},
          suggestion: `The current flow jumps back and forth among multiple code neighborhoods. Merge operations within the same module cluster before switching context`,
          evidence: {
            type: 'medium',
            details: {
              type: 'alternating_pattern',
              pattern: pattern.pattern,
              patternCount: pattern.count,
              scope: 'code_context',
            },
          },
          deduction: 1.0,
        });
      }
    }

    // Detect back-edges (indicating a non-DAG structure)
    const backEdges = this.findBackEdges(callGraph);
    const contextBackEdges = this.findBackEdges(contextGraph);

    if (backEdges.length > 0) {
      issues.push({
        metric: 'contextCoupling',
        severity: Severity.Warning,
        message: `Detected ${backEdges.length} back dependency edges; the workflow is not a directed acyclic graph (DAG)`,
        location: {},
        suggestion: `An ideal workflow should be a DAG structure. Refactor to eliminate back dependencies`,
        evidence: {
          type: 'medium',
          details: {
            type: 'back_edge',
            backEdges: backEdges.map(e => `${e.from}→${e.to}`),
            count: backEdges.length,
          },
        },
        deduction: 1.0,
      });
    }

    if (contextBackEdges.length > 0) {
      issues.push({
        metric: 'contextCoupling',
        severity: Severity.Warning,
        message: `Detected ${contextBackEdges.length} code context back dependency edges; the execution flow circles back among multiple code neighborhoods`,
        location: {},
        suggestion: `Aggregate work belonging to the same code neighborhood to reduce cross-module round trips`,
        evidence: {
          type: 'medium',
          details: {
            type: 'back_edge',
            backEdges: contextBackEdges.map((edge) => `${edge.from}→${edge.to}`),
            count: contextBackEdges.length,
            scope: 'code_context',
          },
        },
        deduction: 1.0,
      });
    }

    return finalizeDetectorIssues(issues, this.config);
  }

  /**
   * Build the call graph
   */
  private buildCallGraph(): Map<string, Set<string>> {
    const graph = new Map<string, Set<string>>();

    // Initialize nodes
    const allActors = new Set<string>();
    allActors.add('main'); // Main flow

    // Add all agents
    for (const agentId of this.sessionData.agents.keys()) {
      allActors.add(agentId);
    }

    // Initialize the adjacency list
    for (const actor of allActors) {
      graph.set(actor, new Set());
    }

    // Build edges
    const toolUses = Array.from(this.sessionData.toolUses.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    for (const toolUse of toolUses) {
      const from = toolUse.agentId || 'main';

      // If the Agent tool was invoked, create an edge
      if (toolUse.name === 'Agent') {
        const to = toolUse.id; // The Agent's ID

        if (graph.has(from)) {
          graph.get(from)!.add(to);
        }
      }
    }

    return graph;
  }

  private buildContextSequence(): Array<{ key: string; footprint: CodeFootprint }> {
    const sequence: Array<{ key: string; footprint: CodeFootprint }> = [];
    const toolUses = Array.from(this.sessionData.toolUses.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    for (const toolUse of toolUses) {
      const footprint = this.codeContext.getToolFootprint(toolUse);
      const key = this.getContextKey(footprint);
      if (!key) {
        continue;
      }
      if (sequence.length > 0 && sequence[sequence.length - 1].key === key) {
        continue;
      }
      sequence.push({ key, footprint });
    }

    return sequence;
  }

  private buildContextGraph(sequence: Array<{ key: string; footprint: CodeFootprint }>): Map<string, Set<string>> {
    const graph = new Map<string, Set<string>>();

    for (const item of sequence) {
      if (!graph.has(item.key)) {
        graph.set(item.key, new Set());
      }
    }

    for (let i = 1; i < sequence.length; i++) {
      const previous = sequence[i - 1].key;
      const current = sequence[i].key;
      if (!graph.has(previous)) {
        graph.set(previous, new Set());
      }
      graph.get(previous)!.add(current);
    }

    return graph;
  }

  /**
   * Find strongly connected components (Tarjan's algorithm)
   */
  private findStronglyConnectedComponents(graph: Map<string, Set<string>>): string[][] {
    const sccs: string[][] = [];
    const index = new Map<string, number>();
    const lowlink = new Map<string, number>();
    const onStack = new Map<string, boolean>();
    const stack: string[] = [];
    let currentIndex = 0;

    const strongConnect = (v: string) => {
      index.set(v, currentIndex);
      lowlink.set(v, currentIndex);
      currentIndex++;
      stack.push(v);
      onStack.set(v, true);

      const neighbors = graph.get(v) || new Set();
      for (const w of neighbors) {
        if (!index.has(w)) {
          strongConnect(w);
          lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
        } else if (onStack.get(w)) {
          lowlink.set(v, Math.min(lowlink.get(v)!, index.get(w)!));
        }
      }

      if (lowlink.get(v) === index.get(v)) {
        const scc: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.set(w, false);
          scc.push(w);
        } while (w !== v);

        if (scc.length > 1) {
          sccs.push(scc);
        }
      }
    };

    for (const v of graph.keys()) {
      if (!index.has(v)) {
        strongConnect(v);
      }
    }

    return sccs;
  }

  /**
   * Detect alternating invocation patterns
   */
  private detectAlternatingCalls(graph: Map<string, Set<string>>): Array<{
    pattern: string[];
    count: number;
  }> {
    const patterns: Array<{ pattern: string[]; count: number }> = [];

    // Get tool invocations sorted by time
    const toolUses = Array.from(this.sessionData.toolUses.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    // Extract the invocation sequence
    const callSequence = toolUses
      .filter(t => t.name === 'Agent')
      .map(t => t.agentId || 'main');

    // Detect the A-B-A-B pattern
    for (let i = 0; i < callSequence.length - 3; i++) {
      const a = callSequence[i];
      const b = callSequence[i + 1];

      if (a !== b) {
        let count = 1;
        let j = i + 2;

        while (j < callSequence.length - 1 &&
               callSequence[j] === a &&
               callSequence[j + 1] === b) {
          count++;
          j += 2;
        }

        if (count >= 2) {
          patterns.push({
            pattern: [a, b],
            count,
          });
          i = j - 1; // Skip the portion already detected
        }
      }
    }

    return patterns;
  }

  private detectAlternatingContexts(
    sequence: Array<{ key: string; footprint: CodeFootprint }>
  ): Array<{ pattern: string[]; count: number }> {
    const patterns: Array<{ pattern: string[]; count: number }> = [];

    for (let i = 0; i < sequence.length - 3; i++) {
      const a = sequence[i];
      const b = sequence[i + 1];
      if (a.key === b.key) {
        continue;
      }

      let count = 1;
      let j = i + 2;

      while (
        j < sequence.length - 1 &&
        sequence[j].key === a.key &&
        sequence[j + 1].key === b.key
      ) {
        count++;
        j += 2;
      }

      if (count >= 2) {
        patterns.push({
          pattern: [a.key, b.key],
          count,
        });
        i = j - 1;
      }
    }

    return patterns;
  }

  /**
   * Find back edges
   */
  private findBackEdges(graph: Map<string, Set<string>>): Array<{ from: string; to: string }> {
    const backEdges: Array<{ from: string; to: string }> = [];
    const visited = new Map<string, boolean>();
    const recStack = new Map<string, boolean>();

    const dfs = (v: string) => {
      visited.set(v, true);
      recStack.set(v, true);

      const neighbors = graph.get(v) || new Set();
      for (const w of neighbors) {
        if (!visited.get(w)) {
          dfs(w);
        } else if (recStack.get(w)) {
          // Back edge found
          backEdges.push({ from: v, to: w });
        }
      }

      recStack.set(v, false);
    };

    for (const v of graph.keys()) {
      if (!visited.get(v)) {
        dfs(v);
      }
    }

    return backEdges;
  }

  private getContextKey(footprint: CodeFootprint): string | undefined {
    const directContext = Array.from(new Set(footprint.directFiles)).sort();
    if (directContext.length > 0) {
      return `ctx:${directContext.slice(0, 3).join('|')}`;
    }

    const strongContext = Array.from(new Set(footprint.strongRelatedFiles)).sort();
    if (strongContext.length > 0) {
      return `ctx:${strongContext.slice(0, 3).join('|')}`;
    }

    const weakContext = Array.from(footprint.weakRelatedFiles).sort();
    if (weakContext.length > 0) {
      return `ctx:${weakContext.slice(0, 3).join('|')}`;
    }

    const symbols = Array.from(footprint.symbols).sort();
    if (symbols.length > 0) {
      return `sym:${symbols.slice(0, 3).join('|')}`;
    }

    return undefined;
  }
}
