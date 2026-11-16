import { SessionData } from '../ClaudeCodeStructure/src/types';
import { JsonlParser } from '../ClaudeCodeStructure/src/JsonlParser';
import {
  EvaluationConfig,
  EvaluationReport,
  EvaluationResult,
  ContextChainAnalysisSummary,
  EventStreamAnalysisSummary,
  ExecutionContextSummary,
} from './types/evaluation.types';
import { DEFAULT_EVALUATION_CONFIG } from './config/evaluation.config';
import { ScoreCalculator } from './scoring/ScoreCalculator';
import { ReportGenerator } from './scoring/ReportGenerator';
import { ToolUseEfficiencyEvaluator } from './evaluators/ToolUseEfficiencyEvaluator';
import { WorkflowArchitectureEvaluator } from './evaluators/WorkflowArchitectureEvaluator';
import { ContextManagementEvaluator } from './evaluators/ContextManagementEvaluator';
import { ToolEcosystemEvaluator } from './evaluators/ToolEcosystemEvaluator';
import { TaskOutcomeEvaluator } from './evaluators/TaskOutcomeEvaluator';
import { ContextChainAnalyzer } from './analyzers/ContextChainAnalyzer';
import { EventStreamConverter } from './analyzers/EventStreamConverter';
import { extractDefectPosteriorRisks } from './benchmark/ProcCtrlScorecard';
import { computePaperControlPreservation } from './benchmark/PaperControlPreservation';
import * as fs from 'fs';
import * as path from 'path';

export interface AgentEvaluatorOptions {
  /**
   * 使用论文 v8 附录 A.5 的 CP 公式，而不是旧的启发式 CP。
   * 论文复现入口默认开启；普通单会话诊断仍可保持 legacy 行为。
   */
  paperControlPreservation?: boolean;
}

/**
 * Agent评估器主类
 */
export class AgentEvaluator {
  private sessionData: SessionData;
  private config: EvaluationConfig;
  private runId: string;
  private contextChains: ContextChainAnalyzer;
  private eventStreamConverter: EventStreamConverter;
  private options: AgentEvaluatorOptions;

  constructor(
    sessionData: SessionData,
    config: EvaluationConfig = DEFAULT_EVALUATION_CONFIG,
    options: AgentEvaluatorOptions = {}
  ) {
    this.sessionData = sessionData;
    this.config = config;
    this.runId = this.extractRunId();
    this.contextChains = new ContextChainAnalyzer(sessionData);
    this.eventStreamConverter = new EventStreamConverter(sessionData);
    this.options = options;
  }

  /**
   * 从JSONL文件创建评估器
   */
  static async fromJsonlFile(
    filePath: string,
    config: EvaluationConfig = DEFAULT_EVALUATION_CONFIG,
    options: AgentEvaluatorOptions = {}
  ): Promise<AgentEvaluator> {
    const parser = new JsonlParser();
    const sessionData = await parser.parseFile(filePath);
    return new AgentEvaluator(sessionData, config, options);
  }

  /**
   * 执行完整评估
   */
  async evaluate(): Promise<EvaluationReport> {
    console.log(`开始评估 Run ID: ${this.runId}`);
    const contextChainSummary = this.contextChains.buildSummary();
    const eventStreamSummary = this.eventStreamConverter.buildSummary();
    console.log(
      `上下文链分析: ${contextChainSummary.analyzedSteps} 步, 平均链长度 ${contextChainSummary.averageChainLength.toFixed(2)}, 最大链长度 ${contextChainSummary.maxChainLength}`
    );
    console.log(
      `标准事件流: ${eventStreamSummary.totalEvents} 事件 (${eventStreamSummary.messageEvents} message / ${eventStreamSummary.toolCallEvents} tool_call / ${eventStreamSummary.toolResultEvents} tool_result)`
    );

    const dimensionResults: {
      contextManagement?: EvaluationResult;
      toolUseEfficiency?: EvaluationResult;
      workflowArchitecture?: EvaluationResult;
      toolEcosystemConsistency?: EvaluationResult;
      taskOutcome?: EvaluationResult;
    } = {};

    // 工具使用效率评估
    console.log('评估工具使用效率...');
    const toolUseEvaluator = new ToolUseEfficiencyEvaluator(this.sessionData, this.config);
    dimensionResults.toolUseEfficiency = await toolUseEvaluator.evaluate();
    console.log(`  - 告警: ${dimensionResults.toolUseEfficiency.warnings}, 错误: ${dimensionResults.toolUseEfficiency.errors}`);

    // 工作流架构评估
    console.log('评估工作流架构...');
    const workflowEvaluator = new WorkflowArchitectureEvaluator(this.sessionData, this.config);
    dimensionResults.workflowArchitecture = await workflowEvaluator.evaluate();
    console.log(`  - 告警: ${dimensionResults.workflowArchitecture.warnings}, 错误: ${dimensionResults.workflowArchitecture.errors}`);

    // 上下文管理评估
    console.log('评估上下文管理...');
    const contextManagementEvaluator = new ContextManagementEvaluator(this.sessionData, this.config);
    dimensionResults.contextManagement = await contextManagementEvaluator.evaluate();
    console.log(`  - 告警: ${dimensionResults.contextManagement.warnings}, 错误: ${dimensionResults.contextManagement.errors}`);

    // 工具生态一致性评估
    console.log('评估工具生态一致性...');
    const toolEcosystemEvaluator = new ToolEcosystemEvaluator(this.sessionData, this.config);
    dimensionResults.toolEcosystemConsistency = await toolEcosystemEvaluator.evaluate();
    console.log(`  - 告警: ${dimensionResults.toolEcosystemConsistency.warnings}, 错误: ${dimensionResults.toolEcosystemConsistency.errors}`);

    // 任务结果评估
    console.log('评估任务结果...');
    const taskOutcomeEvaluator = new TaskOutcomeEvaluator(this.sessionData, this.config);
    dimensionResults.taskOutcome = await taskOutcomeEvaluator.evaluate();
    console.log(`  - 完成率: ${(dimensionResults.taskOutcome.details.taskCompletionRate * 100).toFixed(0)}%, 可执行性: ${(dimensionResults.taskOutcome.details.outputExecutability * 100).toFixed(0)}%, 验证率: ${(dimensionResults.taskOutcome.details.postModificationVerificationRate * 100).toFixed(0)}%`);

    // 计算最终报告
    console.log('生成评估报告...');
    const calculator = new ScoreCalculator(this.config);
    const report = calculator.calculateReport(
      this.runId,
      dimensionResults,
      contextChainSummary,
      this.buildExecutionContextSummary(),
      eventStreamSummary
    );

    if (this.options.paperControlPreservation) {
      const risks = extractDefectPosteriorRisks(report.findings || []);
      const paperControl = computePaperControlPreservation(this.sessionData, risks);
      report.controlPreservation = {
        score: paperControl.score,
        level: paperControl.level,
        metrics: paperControl.metrics,
        evidence: [
          `论文 Appendix A.5 CP: toolCalls=${paperControl.features.toolCalls}, ` +
            `anchored=${paperControl.features.anchoredToolCalls}, ` +
            `recovered=${paperControl.features.recoveredFailures}/${paperControl.features.failedToolCalls}, ` +
            `checkpointed=${paperControl.features.checkpointedMutations}/${paperControl.features.mutatingOperations}, ` +
            `escalated=${paperControl.features.escalatedFailures}/${paperControl.features.failedToolCalls}.`,
        ],
      };
      report.controlPreservationSource = paperControl.source;
      report.controlPreservationRawScore = paperControl.rawScore;
      report.controlPreservationFeatures = paperControl.features as unknown as Record<string, number>;
    }

    console.log('评估完成! 已生成非评分制诊断报告');
    console.log(`总告警: ${report.summary.totalWarnings}, 总错误: ${report.summary.totalErrors}`);

    return report;
  }

  /**
   * 评估并保存报告
   */
  async evaluateAndSave(
    outputDir: string,
    formats: Array<'json' | 'markdown'> = ['json', 'markdown']
  ): Promise<EvaluationReport> {
    const report = await this.evaluate();
    this.writeContextAnalysisArtifact(outputDir, report);

    const generator = new ReportGenerator();
    await generator.saveReport(report, outputDir, formats);

    console.log(`报告已保存到: ${outputDir}`);

    return report;
  }

  /**
   * 提取Run ID
   */
  private extractRunId(): string {
    // 从第一条消息或其他地方提取run ID
    const firstMessage = Array.from(this.sessionData.messages.values())[0];
    if (firstMessage) {
      // 简化处理: 使用第一条消息的UUID前8位
      return firstMessage.uuid.substring(0, 8);
    }
    return 'unknown';
  }

  /**
   * 获取Session统计信息
   */
  getSessionStats(): any {
    return {
      totalMessages: this.sessionData.statistics.totalMessages,
      totalToolUses: this.sessionData.statistics.totalToolUses,
      totalAgents: this.sessionData.statistics.totalAgents,
      totalTokens: this.sessionData.statistics.totalTokens.input + this.sessionData.statistics.totalTokens.output,
      duration: Math.round(this.sessionData.statistics.timeRange.duration / 1000),
    };
  }

  getContextAnalysisSummary(): ContextChainAnalysisSummary {
    return this.contextChains.buildSummary();
  }

  getEventStreamSummary(): EventStreamAnalysisSummary {
    return this.eventStreamConverter.buildSummary();
  }

  private buildExecutionContextSummary(): ExecutionContextSummary {
    let verificationAttempts = 0;
    let successfulVerifications = 0;
    let failedToolCalls = 0;
    let successfulToolCalls = 0;

    for (const toolUse of this.sessionData.toolUses.values()) {
      const result = this.sessionData.toolResults.get(toolUse.id);
      if (result?.is_error) {
        failedToolCalls++;
      } else if (result) {
        successfulToolCalls++;
      }

      if (toolUse.name === 'Bash') {
        const command = String(toolUse.input.command || '');
        if (this.isVerificationCommand(command)) {
          verificationAttempts++;
          if (result && !result.is_error) {
            successfulVerifications++;
          }
        }
      }
    }

    let checkpointSignals = 0;
    let handoffSignals = 0;
    let userMessages = 0;
    let assistantMessages = 0;

    for (const message of this.sessionData.messages.values()) {
      if (message.type === 'user') {
        userMessages++;
        continue;
      }
      if (message.type !== 'assistant') {
        continue;
      }

      assistantMessages++;
      const content = this.extractMessageText(message.content).toLowerCase();
      if (
        ['checkpoint', 'summary', 'progress', 'next step', 'plan', '阶段', '检查点', '总结', '进度'].some(
          keyword => content.includes(keyword)
        )
      ) {
        checkpointSignals++;
      }
      if (
        ['handoff', 'need user', 'confirm', 'review', '人工', '确认', '接管', '选择', '决定'].some(
          keyword => content.includes(keyword)
        )
      ) {
        handoffSignals++;
      }
    }

    return {
      totalMessages: this.sessionData.statistics.totalMessages,
      totalToolUses: this.sessionData.statistics.totalToolUses,
      totalAgents: this.sessionData.statistics.totalAgents,
      totalBranches: this.sessionData.statistics.totalBranches,
      userMessages,
      assistantMessages,
      verificationAttempts,
      successfulVerifications,
      failedToolCalls,
      successfulToolCalls,
      checkpointSignals,
      handoffSignals,
    };
  }

  private isVerificationCommand(command: string): boolean {
    return [
      'test',
      'build',
      'lint',
      'check',
      'verify',
      'pytest',
      'jest',
      'vitest',
      'tsc',
      'eslint',
    ].some(keyword => command.includes(keyword));
  }

  private extractMessageText(content: any): string {
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .map(block => {
          if (!block || typeof block !== 'object') {
            return '';
          }
          if (block.type === 'text') {
            return String(block.text || '');
          }
          if (block.type === 'tool_result') {
            return typeof block.content === 'string' ? block.content : '';
          }
          return '';
        })
        .join('\n');
    }
    return '';
  }

  private writeContextAnalysisArtifact(outputDir: string, report: EvaluationReport): void {
    const contextAnalysisPath = path.join(outputDir, `context-analysis-${this.runId}.json`);
    const eventStreamPath = path.join(outputDir, `standard-event-stream-${this.runId}.json`);
    const contextChainMapPath = path.join(
      process.cwd(),
      'ClaudeCodeStructure',
      'tests',
      'output',
      'context-chains.json'
    );
    const artifact = {
      runId: this.runId,
      generatedAt: new Date().toISOString(),
      summary: this.contextChains.buildSummary(),
      steps: this.contextChains.buildStepAnalyses(),
    };

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(contextAnalysisPath, JSON.stringify(artifact, null, 2), 'utf-8');
    fs.mkdirSync(path.dirname(contextChainMapPath), { recursive: true });
    fs.writeFileSync(
      contextChainMapPath,
      JSON.stringify(this.contextChains.buildContextChainMap(), null, 2),
      'utf-8'
    );

    const eventStreamArtifact = {
      runId: this.runId,
      generatedAt: new Date().toISOString(),
      summary: this.eventStreamConverter.buildSummary(),
      events: this.eventStreamConverter.convert(),
    };
    fs.writeFileSync(eventStreamPath, JSON.stringify(eventStreamArtifact, null, 2), 'utf-8');
    if (report.analysis?.contextChains) {
      report.analysis.contextChains.outputPath = contextAnalysisPath;
      report.analysis.contextChains.contextChainMapPath = contextChainMapPath;
    }
    if (report.analysis?.standardEventStream) {
      report.analysis.standardEventStream.outputPath = eventStreamPath;
    }
  }
}
