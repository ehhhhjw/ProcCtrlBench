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
import * as fs from 'fs';
import * as path from 'path';

/**
 * Main Agent evaluator class
 */
export class AgentEvaluator {
  private sessionData: SessionData;
  private config: EvaluationConfig;
  private runId: string;
  private contextChains: ContextChainAnalyzer;
  private eventStreamConverter: EventStreamConverter;

  constructor(sessionData: SessionData, config: EvaluationConfig = DEFAULT_EVALUATION_CONFIG) {
    this.sessionData = sessionData;
    this.config = config;
    this.runId = this.extractRunId();
    this.contextChains = new ContextChainAnalyzer(sessionData);
    this.eventStreamConverter = new EventStreamConverter(sessionData);
  }

  /**
   * Creates an evaluator from a JSONL file
   */
  static async fromJsonlFile(
    filePath: string,
    config: EvaluationConfig = DEFAULT_EVALUATION_CONFIG
  ): Promise<AgentEvaluator> {
    const parser = new JsonlParser();
    const sessionData = await parser.parseFile(filePath);
    return new AgentEvaluator(sessionData, config);
  }

  /**
   * Runs the full evaluation
   */
  async evaluate(): Promise<EvaluationReport> {
    console.log(`Starting evaluation for Run ID: ${this.runId}`);
    const contextChainSummary = this.contextChains.buildSummary();
    const eventStreamSummary = this.eventStreamConverter.buildSummary();
    console.log(
      `Context chain analysis: ${contextChainSummary.analyzedSteps} steps, average chain length ${contextChainSummary.averageChainLength.toFixed(2)}, max chain length ${contextChainSummary.maxChainLength}`
    );
    console.log(
      `Standard event stream: ${eventStreamSummary.totalEvents} events (${eventStreamSummary.messageEvents} message / ${eventStreamSummary.toolCallEvents} tool_call / ${eventStreamSummary.toolResultEvents} tool_result)`
    );

    const dimensionResults: {
      contextManagement?: EvaluationResult;
      toolUseEfficiency?: EvaluationResult;
      workflowArchitecture?: EvaluationResult;
      toolEcosystemConsistency?: EvaluationResult;
      taskOutcome?: EvaluationResult;
    } = {};

    // Tool use efficiency evaluation
    console.log('Evaluating tool use efficiency...');
    const toolUseEvaluator = new ToolUseEfficiencyEvaluator(this.sessionData, this.config);
    dimensionResults.toolUseEfficiency = await toolUseEvaluator.evaluate();
    console.log(`  - warnings: ${dimensionResults.toolUseEfficiency.warnings}, errors: ${dimensionResults.toolUseEfficiency.errors}`);

    // Workflow architecture evaluation
    console.log('Evaluating workflow architecture...');
    const workflowEvaluator = new WorkflowArchitectureEvaluator(this.sessionData, this.config);
    dimensionResults.workflowArchitecture = await workflowEvaluator.evaluate();
    console.log(`  - warnings: ${dimensionResults.workflowArchitecture.warnings}, errors: ${dimensionResults.workflowArchitecture.errors}`);

    // Context management evaluation
    console.log('Evaluating context management...');
    const contextManagementEvaluator = new ContextManagementEvaluator(this.sessionData, this.config);
    dimensionResults.contextManagement = await contextManagementEvaluator.evaluate();
    console.log(`  - warnings: ${dimensionResults.contextManagement.warnings}, errors: ${dimensionResults.contextManagement.errors}`);

    // Tool ecosystem consistency evaluation
    console.log('Evaluating tool ecosystem consistency...');
    const toolEcosystemEvaluator = new ToolEcosystemEvaluator(this.sessionData, this.config);
    dimensionResults.toolEcosystemConsistency = await toolEcosystemEvaluator.evaluate();
    console.log(`  - warnings: ${dimensionResults.toolEcosystemConsistency.warnings}, errors: ${dimensionResults.toolEcosystemConsistency.errors}`);

    // Task outcome evaluation
    console.log('Evaluating task outcome...');
    const taskOutcomeEvaluator = new TaskOutcomeEvaluator(this.sessionData, this.config);
    dimensionResults.taskOutcome = await taskOutcomeEvaluator.evaluate();
    console.log(`  - completion rate: ${(dimensionResults.taskOutcome.details.taskCompletionRate * 100).toFixed(0)}%, executability: ${(dimensionResults.taskOutcome.details.outputExecutability * 100).toFixed(0)}%, verification rate: ${(dimensionResults.taskOutcome.details.postModificationVerificationRate * 100).toFixed(0)}%`);

    // Compute the final report
    console.log('Generating evaluation report...');
    const calculator = new ScoreCalculator(this.config);
    const report = calculator.calculateReport(
      this.runId,
      dimensionResults,
      contextChainSummary,
      this.buildExecutionContextSummary(),
      eventStreamSummary
    );

    console.log('Evaluation complete! A non-scoring diagnostic report has been generated');
    console.log(`Total warnings: ${report.summary.totalWarnings}, total errors: ${report.summary.totalErrors}`);

    return report;
  }

  /**
   * Runs the evaluation and saves the report
   */
  async evaluateAndSave(
    outputDir: string,
    formats: Array<'json' | 'markdown'> = ['json', 'markdown']
  ): Promise<EvaluationReport> {
    const report = await this.evaluate();
    this.writeContextAnalysisArtifact(outputDir, report);

    const generator = new ReportGenerator();
    await generator.saveReport(report, outputDir, formats);

    console.log(`Report saved to: ${outputDir}`);

    return report;
  }

  /**
   * Extracts the Run ID
   */
  private extractRunId(): string {
    // Extract the run ID from the first message or elsewhere
    const firstMessage = Array.from(this.sessionData.messages.values())[0];
    if (firstMessage) {
      // Simplified handling: use the first 8 characters of the first message UUID
      return firstMessage.uuid.substring(0, 8);
    }
    return 'unknown';
  }

  /**
   * Returns session statistics
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
        ['checkpoint', 'summary', 'progress', 'next step', 'plan'].some(
          keyword => content.includes(keyword)
        )
      ) {
        checkpointSignals++;
      }
      if (
        ['handoff', 'need user', 'confirm', 'review'].some(
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
