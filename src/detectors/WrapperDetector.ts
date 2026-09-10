import { SessionData, MessageNode, ToolUseInfo } from '../../ClaudeCodeStructure/src/types';
import { IDetector, DetectionIssue, Severity, EvaluationConfig } from '../types/evaluation.types';
import { WrapperWorkflowInfo } from '../types/metrics.types';
import { ContentSimilarityAnalyzer } from '../analyzers/ContentSimilarityAnalyzer';
import { AstAnalyzer } from '../analyzers/AstAnalyzer';
import { ProjectAstLoader } from '../analyzers/ProjectAstLoader';
import { writePrewarn } from '../utils/Prewarn';
import { finalizeDetectorIssues } from './detector-calibration';

/**
 * 包装工作流检测器
 * 检测仅透传输入给下游工具，无附加价值的工作流
 */
export class WrapperDetector implements IDetector {
  readonly name = 'WrapperDetector';
  private sessionData: SessionData;
  private config: EvaluationConfig;
  private ast?: AstAnalyzer;
  private projectAst?: ProjectAstLoader;

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
  }

  async detect(): Promise<DetectionIssue[]> {
    const issues: DetectionIssue[] = [];

    // 识别所有Agent调用
    const agentCalls = this.identifyAgentCalls();

    // 按照agentId分组，统计每个Agent的调用次数和包装行为
    const agentCallGroups = new Map<string, Array<{
      agentId: string;
      initiatorUuid: string;
      toolUse: ToolUseInfo;
    }>>();

    for (const agentCall of agentCalls) {
      // 使用agentName作为分组key(如果有)，否则使用agentId
      const agent = this.sessionData.agents.get(agentCall.agentId);
      const groupKey = agent?.name || agentCall.agentId;

      if (!agentCallGroups.has(groupKey)) {
        agentCallGroups.set(groupKey, []);
      }
      agentCallGroups.get(groupKey)!.push(agentCall);
    }

    // 对每个Agent组进行分析
    for (const [groupKey, calls] of agentCallGroups) {
      // 关键修复: 只对调用次数≥5次的Agent进行判定
      if (calls.length < 5) {
        continue; // 跳过调用次数不足的Agent
      }

      // 分析每次调用，统计包装行为
      let wrapperCount = 0;
      const analyses: Array<WrapperWorkflowInfo & { isWrapper: boolean }> = [];

      for (const call of calls) {
        const analysis = this.analyzeAgentCall(call);
        analyses.push(analysis);
        if (analysis.isWrapper) {
          wrapperCount++;
        }
      }

      // 计算包装率 (多次调用中有多少比例是wrapper行为)
      const wrapperRate = wrapperCount / calls.length;

      // 临近阈值的预警（不触发问题，仅提示）
      if (wrapperRate >= 0.75 && wrapperRate < 0.80) {
        writePrewarn({
          metric: 'wrapperWorkflow',
          message: `Agent包装率接近阈值: ${(wrapperRate * 100).toFixed(0)}%`,
          details: { group: groupKey, totalCalls: calls.length },
        });
      }

      // 判定: ≥80% warning, ≥95% error
      if (wrapperRate >= 0.80) {
        const severity = wrapperRate >= 0.95 ? Severity.Error : Severity.Warning;
        const deduction = severity === Severity.Error ? 2.0 : 1.0;

        // 使用第一次调用的信息作为代表
        const firstAnalysis = analyses[0];

        issues.push({
          metric: 'wrapperWorkflow',
          severity,
          message: `检测到冗余包装工作流: Agent "${firstAnalysis.agentName || groupKey}" 在${calls.length}次调用中有${wrapperCount}次(${(wrapperRate * 100).toFixed(0)}%)仅透传输入`,
          location: {
            messageUuid: calls[0].initiatorUuid,
          },
          suggestion: `该Agent没有提供附加价值，考虑直接调用下游工具，或为Agent添加验证、转换等逻辑`,
          evidence: {
            type: severity === Severity.Error ? 'strong' : 'medium',
            details: {
              agentId: firstAnalysis.agentId,
              agentName: firstAnalysis.agentName,
              totalCalls: calls.length,
              wrapperCalls: wrapperCount,
              wrapperRate,
              internalSteps: firstAnalysis.internalSteps,
              downstreamToolType: firstAnalysis.downstreamToolType,
            },
          },
          deduction,
        });
      }
    }

    return finalizeDetectorIssues(issues, this.config);
  }

  /**
   * 识别Agent调用
   */
  private identifyAgentCalls(): Array<{
    agentId: string;
    initiatorUuid: string;
    toolUse: ToolUseInfo;
  }> {
    const agentCalls: Array<{
      agentId: string;
      initiatorUuid: string;
      toolUse: ToolUseInfo;
    }> = [];

    // 方法1: 通过Agent工具调用识别
    for (const toolUse of this.sessionData.toolUses.values()) {
      if (toolUse.name === 'Agent') {
        agentCalls.push({
          agentId: toolUse.id, // 使用tool use id作为标识
          initiatorUuid: toolUse.messageUuid,
          toolUse,
        });
      }
    }

    // 方法2: 通过agentId和isSidechain识别
    for (const agent of this.sessionData.agents.values()) {
      if (agent.messageUuids.length > 0) {
        const firstMessage = this.sessionData.messages.get(agent.messageUuids[0]);
        if (firstMessage) {
          agentCalls.push({
            agentId: agent.agentId,
            initiatorUuid: firstMessage.uuid,
            toolUse: {
              id: agent.agentId,
              name: 'Agent',
              input: {},
              timestamp: agent.createdAt,
              messageId: firstMessage.messageId,
              messageUuid: firstMessage.uuid,
              agentId: agent.agentId,
              hasResult: true,
            },
          });
        }
      }
    }

    return agentCalls;
  }

  /**
   * 分析Agent调用
   */
  private analyzeAgentCall(agentCall: {
    agentId: string;
    initiatorUuid: string;
    toolUse: ToolUseInfo;
  }): WrapperWorkflowInfo & { isWrapper: boolean } {
    const agent = this.sessionData.agents.get(agentCall.agentId);
    const agentName = agent?.name;

    // 获取Agent内部的步骤
    const internalSteps = this.getInternalSteps(agentCall.agentId);
    const downstreamTools = this.getDownstreamTools(internalSteps);

    // 判定条件
    const codeScope = this.analyzeCodeScope(downstreamTools);
    const checks = {
      fewSteps: internalSteps.length <= 1,
      singleToolType: this.hasSingleToolType(downstreamTools),
      highInputSimilarity: this.calculateInputSimilarity(agentCall.toolUse.input, downstreamTools),
      highOutputSimilarity: this.calculateOutputSimilarity(agentCall, downstreamTools),
      noValidation: !this.hasValidation(internalSteps),
      narrowCodeScope: codeScope.isNarrow,
    };

    // 额外：符号新增占比很低也视为包装迹象
    const symbolDeltaLow = this.hasLowSymbolDelta(agentCall, downstreamTools);
    const passedChecks = [
      checks.fewSteps,
      checks.singleToolType,
      checks.highInputSimilarity,
      checks.highOutputSimilarity,
      checks.noValidation,
      checks.narrowCodeScope,
      symbolDeltaLow,
    ].filter(v => v).length;
    const wrapperRate = passedChecks / 7;

    const isWrapper = wrapperRate >= 0.8; // 80%以上的条件满足

    return {
      agentId: agentCall.agentId,
      agentName,
      internalSteps: internalSteps.length,
      downstreamToolType: this.getMostCommonToolType(downstreamTools),
      inputSimilarity: checks.highInputSimilarity ? 0.85 : 0.4,
      outputSimilarity: checks.highOutputSimilarity ? 0.85 : 0.4,
      wrapperRate,
      isWrapper,
    };
  }

  /**
   * 获取Agent内部步骤
   */
  private getInternalSteps(agentId: string): MessageNode[] {
    const steps: MessageNode[] = [];

    for (const message of this.sessionData.messages.values()) {
      if (message.agentId === agentId && message.isSidechain) {
        steps.push(message);
      }
    }

    return steps.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * 获取下游工具调用
   */
  private getDownstreamTools(steps: MessageNode[]): ToolUseInfo[] {
    const tools: ToolUseInfo[] = [];

    for (const step of steps) {
      for (const toolUse of step.toolUses) {
        // 排除元工具
        if (toolUse.name !== 'Agent' && toolUse.name !== 'AskUserQuestion') {
          tools.push(toolUse);
        }
      }
    }

    return tools;
  }

  /**
   * 检查是否只有单一工具类型
   */
  private hasSingleToolType(tools: ToolUseInfo[]): boolean {
    if (tools.length === 0) return true;

    const toolTypes = new Set(tools.map(t => t.name));
    return toolTypes.size === 1;
  }

  /**
   * 计算输入相似度
   */
  private calculateInputSimilarity(agentInput: any, downstreamTools: ToolUseInfo[]): boolean {
    if (downstreamTools.length === 0) return false;

    // 比较Agent输入和第一个下游工具的输入
    const firstTool = downstreamTools[0];
    const similarity = ContentSimilarityAnalyzer.calculateStructuralSimilarity(
      agentInput,
      firstTool.input
    );

    return similarity > 0.8;
  }

  /**
   * 计算输出相似度
   */
  private calculateOutputSimilarity(
    agentCall: { agentId: string; toolUse: ToolUseInfo },
    downstreamTools: ToolUseInfo[]
  ): boolean {
    if (downstreamTools.length === 0) return false;

    // 获取Agent的输出
    const agentResult = this.sessionData.toolResults.get(agentCall.toolUse.id);
    if (!agentResult) return false;

    // 获取最后一个下游工具的输出
    const lastTool = downstreamTools[downstreamTools.length - 1];
    const lastToolResult = this.sessionData.toolResults.get(lastTool.id);
    if (!lastToolResult) return false;

    // 比较内容
    const agentContent = this.extractContent(agentResult.content);
    const toolContent = this.extractContent(lastToolResult.content);

    const similarity = ContentSimilarityAnalyzer.calculateSimilarity(agentContent, toolContent);

    return similarity > 0.8;
  }

  /**
   * Agent输出与下��最终输出在符号层面的新增占比是否很低。
   */
  private hasLowSymbolDelta(
    agentCall: { agentId: string; toolUse: ToolUseInfo },
    downstreamTools: ToolUseInfo[]
  ): boolean {
    if (!this.ast || downstreamTools.length === 0) return false;
    const agentResult = this.sessionData.toolResults.get(agentCall.toolUse.id);
    const lastTool = downstreamTools[downstreamTools.length - 1];
    const lastToolResult = this.sessionData.toolResults.get(lastTool.id);
    if (!agentResult || !lastToolResult) return false;
    const a = this.extractContent(agentResult.content);
    const b = this.extractContent(lastToolResult.content);
    const as = this.ast.extractSymbols(a);
    const bs = this.ast.extractSymbols(b);
    const aset = new Set([
      ...as.classes,
      ...as.functions,
      ...as.methods,
      ...(as.properties || []),
      ...(as.variables || []),
    ]);
    const bset = new Set([
      ...bs.classes,
      ...bs.functions,
      ...bs.methods,
      ...(bs.properties || []),
      ...(bs.variables || []),
    ]);
    if (aset.size === 0) return true; // 无新增符号
    let newSym = 0;
    for (const s of aset) if (!bset.has(s)) newSym++;
    const addedRatio = newSym / aset.size;
    return addedRatio < 0.2;
  }

  /**
   * 检查是否有验证逻辑
   */
  private hasValidation(steps: MessageNode[]): boolean {
    // 检查是否有验证相关的工具调用
    const validationTools = ['Bash', 'Agent'];
    let validationCount = 0;

    for (const step of steps) {
      for (const toolUse of step.toolUses) {
        if (validationTools.includes(toolUse.name)) {
          // 检查是否是测试/验证命令
          if (toolUse.name === 'Bash') {
            const command = toolUse.input.command || '';
            if (command.includes('test') || command.includes('check') || command.includes('verify')) {
              validationCount++;
            }
          }
        }
      }

      // 检查assistant消息是否包含验证逻辑
      if (step.type === 'assistant') {
        const content = this.extractContent(step.content);
        if (content.includes('验证') || content.includes('检查') || content.includes('确认')) {
          validationCount++;
        }
      }
    }

    return validationCount > 0;
  }

  private analyzeCodeScope(tools: ToolUseInfo[]): { touchedFiles: string[]; touchedSymbols: string[]; isNarrow: boolean } {
    const touchedFiles = new Set<string>();
    const touchedSymbols = new Set<string>();

    for (const tool of tools) {
      for (const file of this.extractToolPaths(tool)) {
        touchedFiles.add(file);
        if (this.projectAst) {
          for (const symbol of this.projectAst.getDeclaredSymbols(file)) {
            touchedSymbols.add(symbol);
          }
        }
      }

      const result = this.sessionData.toolResults.get(tool.id);
      if (result && this.ast) {
        const extracted = this.ast.extractSymbols(this.extractContent(result.content), {
          filePath: tool.input.file_path || tool.input.path,
        });
        for (const sym of [
          ...extracted.classes,
          ...extracted.functions,
          ...extracted.methods,
          ...(extracted.properties || []),
          ...(extracted.variables || []),
          ...(extracted.calls || []),
        ]) {
          if (sym) {
            touchedSymbols.add(sym);
          }
        }
      }
    }

    const normalizedFiles = Array.from(touchedFiles);
    let neighborhoodSize = normalizedFiles.length;
    if (this.projectAst) {
      const neighborhood = new Set<string>();
      for (const file of normalizedFiles) {
        neighborhood.add(file);
        for (const related of this.projectAst.getRelatedFiles(file, true)) {
          neighborhood.add(related);
        }
      }
      neighborhoodSize = neighborhood.size;
    }

    const isNarrow = normalizedFiles.length <= 1 && neighborhoodSize <= 3 && touchedSymbols.size <= 8;
    return {
      touchedFiles: normalizedFiles,
      touchedSymbols: Array.from(touchedSymbols),
      isNarrow,
    };
  }

  private extractToolPaths(toolUse: ToolUseInfo): string[] {
    const paths = new Set<string>();
    for (const key of ['file_path', 'path']) {
      const value = toolUse.input?.[key];
      if (typeof value === 'string' && value) {
        paths.add(value);
      }
    }
    return Array.from(paths);
  }

  /**
   * 获取最常见的工具类型
   */
  private getMostCommonToolType(tools: ToolUseInfo[]): string {
    if (tools.length === 0) return 'unknown';

    const counts = new Map<string, number>();

    for (const tool of tools) {
      counts.set(tool.name, (counts.get(tool.name) || 0) + 1);
    }

    let maxCount = 0;
    let mostCommon = 'unknown';

    for (const [toolName, count] of counts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = toolName;
      }
    }

    return mostCommon;
  }

  /**
   * 提取内容
   */
  private extractContent(content: any): string {
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text || '')
        .join('\n');
    }

    return '';
  }
}
