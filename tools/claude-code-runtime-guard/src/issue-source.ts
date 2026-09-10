import * as fs from 'fs';
import * as path from 'path';
import { parseSessionFile } from '../../../ClaudeCodeStructure/src';
import { SessionData } from '../../../ClaudeCodeStructure/src/types';
import { ContextChainAnalyzer } from '../../../src/analyzers/ContextChainAnalyzer';
import { EventStreamConverter } from '../../../src/analyzers/EventStreamConverter';
import { DEFAULT_EVALUATION_CONFIG } from '../../../src/config/evaluation.config';
import { applyCalibrationProfileFromFile } from '../../../src/config/calibration-loader';
import { GhostContextDetector } from '../../../src/detectors/GhostContextDetector';
import { OversizedRulesDetector } from '../../../src/detectors/OversizedRulesDetector';
import { ThrashingDetector } from '../../../src/detectors/ThrashingDetector';
import { ToolChainDetector } from '../../../src/detectors/ToolChainDetector';
import { DeadStepDetector } from '../../../src/detectors/DeadStepDetector';
import { DuplicateStepDetector } from '../../../src/detectors/DuplicateStepDetector';
import { WrapperDetector } from '../../../src/detectors/WrapperDetector';
import { CouplingDetector } from '../../../src/detectors/CouplingDetector';
import { LongChainDetector } from '../../../src/detectors/LongChainDetector';
import { InterfaceConsistencyDetector } from '../../../src/detectors/InterfaceConsistencyDetector';
import { WeakToolDetector } from '../../../src/detectors/WeakToolDetector';
import { TaskOutcomeEvaluator } from '../../../src/evaluators/TaskOutcomeEvaluator';
import { ScoreCalculator } from '../../../src/scoring/ScoreCalculator';
import {
  DetectionIssue,
  EvaluationConfig,
  EvaluationResult,
  ExecutionContextSummary,
  IDetector,
  Severity,
} from '../../../src/types/evaluation.types';
import { AnalysisRequest, AnalysisSnapshot, GuardConfig, RuntimeIssueSource } from './types';

function countLines(filePath: string): number {
  const content = fs.readFileSync(filePath, 'utf-8');
  return content.split('\n').filter((line) => line.trim().length > 0).length;
}

function deriveSessionId(transcriptPath: string): string {
  return path.basename(transcriptPath, path.extname(transcriptPath));
}

function createEvaluationConfig(config: GuardConfig): EvaluationConfig {
  const baseConfig: EvaluationConfig = {
    ...DEFAULT_EVALUATION_CONFIG,
    thresholds: {
      ghostContext: {
        warningTokens: Number(config.benchmarks.ghostContext.thresholds.warningTokens || 512),
        errorTokens: Number(config.benchmarks.ghostContext.thresholds.errorTokens || 1024),
      },
      oversizedRules: {
        warningTokens: Number(config.benchmarks.oversizedRules.thresholds.warningTokens || 2000),
        errorTokens: Number(config.benchmarks.oversizedRules.thresholds.errorTokens || 4000),
        warningRatio: Number(config.benchmarks.oversizedRules.thresholds.warningRatio || 0.2),
        errorRatio: Number(config.benchmarks.oversizedRules.thresholds.errorRatio || 0.35),
      },
      thrashing: {
        windowThreshold: Number(config.benchmarks.contextThrashing.thresholds.windowThreshold || 0.75),
        compressionLookAhead: Number(config.benchmarks.contextThrashing.thresholds.compressionLookAhead || 2),
      },
      toolChain: {
        repetitiveWarningCount: Number(config.benchmarks.toolCallChain.thresholds.repetitiveWarning || 6),
        repetitiveErrorCount: Number(config.benchmarks.toolCallChain.thresholds.repetitiveError || 10),
        cyclicWarningCount: Number(config.benchmarks.toolCallChain.thresholds.cyclicWarning || 3),
        cyclicErrorCount: Number(config.benchmarks.toolCallChain.thresholds.cyclicError || 5),
      },
      longChain: {
        warningLength: Number(config.benchmarks.longChain.thresholds.effectiveWarning || 12),
        errorLength: Number(config.benchmarks.longChain.thresholds.effectiveError || 20),
        simpleWarningLength: Number(config.benchmarks.longChain.thresholds.simpleWarning || 25),
        simpleErrorLength: Number(config.benchmarks.longChain.thresholds.simpleError || 40),
      },
    },
    riskModel: {
      ...DEFAULT_EVALUATION_CONFIG.riskModel,
      calibrationBucketCount: DEFAULT_EVALUATION_CONFIG.riskModel.calibrationBucketCount,
      metricPriors: {
        ...DEFAULT_EVALUATION_CONFIG.riskModel.metricPriors,
      },
      evidenceWeights: {
        ...DEFAULT_EVALUATION_CONFIG.riskModel.evidenceWeights,
      },
      severityAnchors: {
        ...DEFAULT_EVALUATION_CONFIG.riskModel.severityAnchors,
      },
    },
    controlPreservation: {
      weights: {
        ...DEFAULT_EVALUATION_CONFIG.controlPreservation.weights,
      },
    },
    detectorCalibration: {
      ...DEFAULT_EVALUATION_CONFIG.detectorCalibration,
      baselineScores: {
        ...DEFAULT_EVALUATION_CONFIG.detectorCalibration.baselineScores,
      },
    },
  };

  return applyCalibrationProfileFromFile(baseConfig, config.runtime.sources.calibrationProfilePath);
}

type DetectorFactory = (sessionData: SessionData, evaluationConfig: EvaluationConfig) => IDetector;

const DETECTOR_REGISTRY: Array<{ benchmark: string; factory: DetectorFactory }> = [
  { benchmark: 'ghostContext', factory: (s, c) => new GhostContextDetector(s, c) },
  { benchmark: 'oversizedRules', factory: (s, c) => new OversizedRulesDetector(s, c) },
  { benchmark: 'contextThrashing', factory: (s, c) => new ThrashingDetector(s, c) },
  { benchmark: 'toolCallChain', factory: (s, c) => new ToolChainDetector(s, c) },
  { benchmark: 'deadStep', factory: (s, c) => new DeadStepDetector(s, c) },
  { benchmark: 'duplicateStep', factory: (s, c) => new DuplicateStepDetector(s, c) },
  { benchmark: 'wrapperWorkflow', factory: (s, c) => new WrapperDetector(s, c) },
  { benchmark: 'contextCoupling', factory: (s, c) => new CouplingDetector(s, c) },
  { benchmark: 'longChain', factory: (s, c) => new LongChainDetector(s, c) },
  { benchmark: 'inconsistentToolInterface', factory: (s, c) => new InterfaceConsistencyDetector(s, c) },
  { benchmark: 'weakTool', factory: (s, c) => new WeakToolDetector(s, c) },
];

export class DetectorIssueSource implements RuntimeIssueSource {
  async analyzeSession(request: AnalysisRequest, config: GuardConfig): Promise<AnalysisSnapshot> {
    const analysisRoot = path.resolve(request.cwd || config.runtime.analysisRootDir || process.cwd());
    const previousCwd = process.cwd();
    const evaluationConfig = createEvaluationConfig(config);
    const transcriptPath = path.resolve(request.transcriptPath);

    try {
      process.chdir(analysisRoot);
      const sessionData = await parseSessionFile(transcriptPath);
      const issues: DetectionIssue[] = [];
      const detectorErrors: string[] = [];

      for (const entry of DETECTOR_REGISTRY) {
        const benchmarkSettings = (config.benchmarks as Record<string, any>)[entry.benchmark];
        if (!benchmarkSettings?.enabled) {
          continue;
        }

        try {
          const detector = entry.factory(sessionData, evaluationConfig);
          issues.push(...(await detector.detect()));
        } catch (error) {
          detectorErrors.push(
            `${entry.benchmark}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      const taskOutcomeEvaluator = new TaskOutcomeEvaluator(sessionData, evaluationConfig);
      const taskOutcome = await taskOutcomeEvaluator.evaluate();
      const contextChainSummary = new ContextChainAnalyzer(sessionData).buildSummary();
      const eventStreamSummary = new EventStreamConverter(sessionData).buildSummary();
      const executionContext = buildExecutionContextSummary(sessionData);
      const dimensionResults = buildDimensionResults(issues, taskOutcome);
      const report = new ScoreCalculator(evaluationConfig).calculateReport(
        request.sessionId || deriveSessionId(transcriptPath),
        dimensionResults,
        contextChainSummary,
        executionContext,
        eventStreamSummary
      );

      return {
        transcriptPath,
        sessionId: request.sessionId || deriveSessionId(request.transcriptPath),
        lineCount: countLines(transcriptPath),
        issues,
        report,
        detectorErrors,
      };
    } finally {
      process.chdir(previousCwd);
    }
  }
}

function buildDimensionResults(
  issues: DetectionIssue[],
  taskOutcome: EvaluationResult
): {
  contextManagement: EvaluationResult;
  toolUseEfficiency: EvaluationResult;
  workflowArchitecture: EvaluationResult;
  toolEcosystemConsistency: EvaluationResult;
  taskOutcome: EvaluationResult;
} {
  const contextManagementIssues = issues.filter((issue) =>
    ['ghostContext', 'oversizedRules', 'contextThrashing', 'thrashing'].includes(issue.metric)
  );
  const toolUseEfficiencyIssues = issues.filter((issue) =>
    ['toolCallChain', 'deadStep', 'duplicateStep'].includes(issue.metric)
  );
  const workflowArchitectureIssues = issues.filter((issue) =>
    ['wrapperWorkflow', 'contextCoupling', 'longChain'].includes(issue.metric)
  );
  const toolEcosystemConsistencyIssues = issues.filter((issue) =>
    ['inconsistentToolInterface', 'interfaceInconsistency', 'weakTool'].includes(issue.metric)
  );

  return {
    contextManagement: {
      dimension: 'contextManagement',
      warnings: countSeverity(contextManagementIssues, Severity.Warning),
      errors: countSeverity(contextManagementIssues, Severity.Error),
      issues: contextManagementIssues,
      details: {
        ghostContext: metricSummary(contextManagementIssues, ['ghostContext']),
        oversizedRules: metricSummary(contextManagementIssues, ['oversizedRules']),
        thrashing: metricSummary(contextManagementIssues, ['contextThrashing', 'thrashing']),
      },
    },
    toolUseEfficiency: {
      dimension: 'toolUseEfficiency',
      warnings: countSeverity(toolUseEfficiencyIssues, Severity.Warning),
      errors: countSeverity(toolUseEfficiencyIssues, Severity.Error),
      issues: toolUseEfficiencyIssues,
      details: {
        toolCallChain: metricSummary(toolUseEfficiencyIssues, ['toolCallChain']),
        deadStep: metricSummary(toolUseEfficiencyIssues, ['deadStep']),
        duplicateStep: metricSummary(toolUseEfficiencyIssues, ['duplicateStep']),
      },
    },
    workflowArchitecture: {
      dimension: 'workflowArchitecture',
      warnings: countSeverity(workflowArchitectureIssues, Severity.Warning),
      errors: countSeverity(workflowArchitectureIssues, Severity.Error),
      issues: workflowArchitectureIssues,
      details: {
        wrapperWorkflow: metricSummary(workflowArchitectureIssues, ['wrapperWorkflow']),
        contextCoupling: metricSummary(workflowArchitectureIssues, ['contextCoupling']),
        longChain: metricSummary(workflowArchitectureIssues, ['longChain']),
      },
    },
    toolEcosystemConsistency: {
      dimension: 'toolEcosystemConsistency',
      warnings: countSeverity(toolEcosystemConsistencyIssues, Severity.Warning),
      errors: countSeverity(toolEcosystemConsistencyIssues, Severity.Error),
      issues: toolEcosystemConsistencyIssues,
      details: {
        inconsistentToolInterface: metricSummary(toolEcosystemConsistencyIssues, ['inconsistentToolInterface', 'interfaceInconsistency']),
        weakTool: metricSummary(toolEcosystemConsistencyIssues, ['weakTool']),
      },
    },
    taskOutcome,
  };
}

function metricSummary(issues: DetectionIssue[], metrics: string[]): { warnings: number; errors: number } {
  const filtered = issues.filter((issue) => metrics.includes(issue.metric));
  return {
    warnings: countSeverity(filtered, Severity.Warning),
    errors: countSeverity(filtered, Severity.Error),
  };
}

function countSeverity(issues: DetectionIssue[], severity: Severity): number {
  return issues.filter((issue) => issue.severity === severity).length;
}

function buildExecutionContextSummary(sessionData: SessionData): ExecutionContextSummary {
  let verificationAttempts = 0;
  let successfulVerifications = 0;
  let failedToolCalls = 0;
  let successfulToolCalls = 0;

  for (const toolUse of sessionData.toolUses.values()) {
    const result = sessionData.toolResults.get(toolUse.id);
    if (result?.is_error) {
      failedToolCalls++;
    } else if (result) {
      successfulToolCalls++;
    }

    if (toolUse.name === 'Bash') {
      const command = String(toolUse.input.command || '');
      if (isVerificationCommand(command)) {
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

  for (const message of sessionData.messages.values()) {
    if (message.type === 'user') {
      userMessages++;
      continue;
    }
    if (message.type !== 'assistant') {
      continue;
    }

    assistantMessages++;
    const content = extractMessageText(message.content).toLowerCase();
    if (
      ['checkpoint', 'summary', 'progress', 'next step', 'plan'].some(
        (keyword) => content.includes(keyword)
      )
    ) {
      checkpointSignals++;
    }
    if (
      ['handoff', 'need user', 'confirm', 'review'].some(
        (keyword) => content.includes(keyword)
      )
    ) {
      handoffSignals++;
    }
  }

  return {
    totalMessages: sessionData.statistics.totalMessages,
    totalToolUses: sessionData.statistics.totalToolUses,
    totalAgents: sessionData.statistics.totalAgents,
    totalBranches: sessionData.statistics.totalBranches,
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

function isVerificationCommand(command: string): boolean {
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
  ].some((keyword) => command.includes(keyword));
}

function extractMessageText(content: any): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((block) => {
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
