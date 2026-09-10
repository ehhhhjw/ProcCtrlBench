import { SessionData, ToolUseInfo } from '../../ClaudeCodeStructure/src/types';
import { IDetector, DetectionIssue, Severity, EvaluationConfig } from '../types/evaluation.types';
import { ContextCouplingInfo } from '../types/metrics.types';
import { AstAnalyzer } from '../analyzers/AstAnalyzer';
import { ProjectAstLoader } from '../analyzers/ProjectAstLoader';
import { CodeContextAnalyzer, CodeFootprint } from '../analyzers/CodeContextAnalyzer';
import { writePrewarn } from '../utils/Prewarn';
import { finalizeDetectorIssues } from './detector-calibration';

/**
 * 上下文耦合检测器
 * 检测Tools/skills/agents间存在交错依赖，非清晰层次结构
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

    // 构建调用图
    const callGraph = this.buildCallGraph();
    const contextSequence = this.buildContextSequence();
    const contextGraph = this.buildContextGraph(contextSequence);

    // 检测强连通分量 (Strongly Connected Components)
    const sccs = this.findStronglyConnectedComponents(callGraph);
    const contextSccs = this.findStronglyConnectedComponents(contextGraph);

    for (const scc of sccs) {
      if (scc.length >= 2) {
        // 发现循环依赖
        if (scc.length === 2) {
          writePrewarn({
            metric: 'contextCoupling',
            message: `检测到小型SCC（可能的循环依赖）: ${scc.join(' ↔ ')}`,
            details: { components: scc },
          });
        }
        issues.push({
          metric: 'contextCoupling',
          severity: Severity.Warning,
          message: `检测到上下文耦合: ${scc.length}个组件存在循环依赖 [${scc.join(' ↔ ')}]`,
          location: {},
          suggestion: `重构工作流，使其成为清晰的层次结构。考虑使用单向数据流，避免循环调用`,
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
          message: `检测到代码上下文耦合: ${scc.length}个代码邻域反复互相依赖 [${scc.join(' ↔ ')}]`,
          location: {},
          suggestion: `代码相关步骤在多个模块簇之间来回切换。考虑按代码邻域分阶段执行，避免上下文反复抖动`,
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

    // 检测交替调用模式
    const alternatingPatterns = this.detectAlternatingCalls(callGraph);
    const alternatingContexts = this.detectAlternatingContexts(contextSequence);

    for (const pattern of alternatingPatterns) {
      if (pattern.count >= 4) {
        issues.push({
          metric: 'contextCoupling',
          severity: Severity.Warning,
          message: `检测到交替调用模式: ${pattern.pattern.join(' ⟷ ')} 重复 ${pattern.count} 次`,
          location: {},
          suggestion: `避免A→B→A→B这样的交替调用。考虑合并逻辑或重新设计接口`,
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
          message: `检测到代码上下文交替: ${pattern.pattern.join(' ⟷ ')} 重复 ${pattern.count} 次`,
          location: {},
          suggestion: `当前流程在多个代码邻域间来回跳转。建议合并同一模块簇内的操作后再切换上下文`,
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

    // 检测back-edge (表示非DAG结构)
    const backEdges = this.findBackEdges(callGraph);
    const contextBackEdges = this.findBackEdges(contextGraph);

    if (backEdges.length > 0) {
      issues.push({
        metric: 'contextCoupling',
        severity: Severity.Warning,
        message: `检测到${backEdges.length}个反向依赖边，工作流不是有向无环图(DAG)`,
        location: {},
        suggestion: `理想的工作流应该是DAG结构。重构以消除反向依赖`,
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
        message: `检测到${contextBackEdges.length}个代码上下文反向依赖边，执行流程在多个代码邻域间形成回流`,
        location: {},
        suggestion: `将同一代码邻域的工作聚合到一起，减少跨模块往返`,
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
   * 构建调用图
   */
  private buildCallGraph(): Map<string, Set<string>> {
    const graph = new Map<string, Set<string>>();

    // 初始化节点
    const allActors = new Set<string>();
    allActors.add('main'); // 主流程

    // 添加所有agents
    for (const agentId of this.sessionData.agents.keys()) {
      allActors.add(agentId);
    }

    // 初始化邻接表
    for (const actor of allActors) {
      graph.set(actor, new Set());
    }

    // 构建边
    const toolUses = Array.from(this.sessionData.toolUses.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    for (const toolUse of toolUses) {
      const from = toolUse.agentId || 'main';

      // 如果调用了Agent工具，建立边
      if (toolUse.name === 'Agent') {
        const to = toolUse.id; // Agent的ID

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
   * 查找强连通分量 (Tarjan算法)
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
   * 检测交替调用模式
   */
  private detectAlternatingCalls(graph: Map<string, Set<string>>): Array<{
    pattern: string[];
    count: number;
  }> {
    const patterns: Array<{ pattern: string[]; count: number }> = [];

    // 获取按时间排序的工具调用
    const toolUses = Array.from(this.sessionData.toolUses.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    // 提取调用序列
    const callSequence = toolUses
      .filter(t => t.name === 'Agent')
      .map(t => t.agentId || 'main');

    // 检测A-B-A-B模式
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
          i = j - 1; // 跳过已检测的部分
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
   * 查找反向边
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
          // 发现反向边
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
