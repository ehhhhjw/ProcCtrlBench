import * as fs from 'fs';
import * as path from 'path';
import { Severity } from '../../../src/types/evaluation.types';
import { RemediationEngine } from './remediation-engine';
import { createDefaultPlannerRegistry } from './planners';
import {
  AnalysisRequest,
  BenchmarkId,
  BenchmarkPlanner,
  GuardAlert,
  GuardAnalysisResult,
  GuardConfig,
  RuntimeIssueSource,
  metricToBenchmarkId,
} from './types';
import { DetectorIssueSource } from './issue-source';

function makeAlertId(sessionId: string, benchmark: string, signature: string): string {
  return `${sessionId}:${benchmark}:${signature}`;
}

function makeIssueSignature(issue: {
  metric: string;
  message: string;
  location?: { messageUuid?: string; toolUseId?: string };
}): string {
  return [
    issue.metric,
    issue.location?.toolUseId || '',
    issue.location?.messageUuid || '',
    issue.message,
  ].join('|');
}

function isWriteLikeToolName(toolName: unknown): boolean {
  if (typeof toolName !== 'string') {
    return false;
  }

  const normalized = toolName.toLowerCase();
  return (
    normalized === 'write' ||
    normalized === 'edit' ||
    normalized.includes('write') ||
    normalized.includes('edit') ||
    normalized.includes('create_file') ||
    normalized.includes('write_to_file')
  );
}

export class RuntimeGuardEngine {
  private readonly issueSource: RuntimeIssueSource;
  private readonly planners: Map<BenchmarkId, BenchmarkPlanner>;
  private readonly remediationEngine: RemediationEngine;
  private readonly cooldowns = new Map<string, number>();

  constructor(
    issueSource: RuntimeIssueSource = new DetectorIssueSource(),
    planners: Map<BenchmarkId, BenchmarkPlanner> = createDefaultPlannerRegistry(),
    remediationEngine: RemediationEngine = new RemediationEngine()
  ) {
    this.issueSource = issueSource;
    this.planners = planners;
    this.remediationEngine = remediationEngine;
  }

  async analyze(request: AnalysisRequest, config: GuardConfig): Promise<GuardAnalysisResult> {
    if (!config.enabled) {
      return {
        sessionId: request.sessionId || 'unknown',
        transcriptPath: request.transcriptPath,
        lineCount: 0,
        alerts: [],
        injections: [],
        guidanceActions: [],
        shouldBlock: false,
        blockReasons: [],
        detectorErrors: [],
        issuesByBenchmark: {},
      };
    }

    const snapshot = await this.issueSource.analyzeSession(request, config);
    const alerts: GuardAlert[] = [];
    const issuesByBenchmark: Record<string, number> = {};

    for (const issue of snapshot.issues) {
      const benchmark = metricToBenchmarkId(issue.metric);
      if (!benchmark) {
        continue;
      }

      const settings = config.benchmarks[benchmark];
      if (!settings?.enabled) {
        continue;
      }

      if (
        benchmark === 'deadStep' &&
        settings.specialRules?.writeNeverDeadStep &&
        isWriteLikeToolName(issue.evidence?.details?.toolName)
      ) {
        continue;
      }

      issuesByBenchmark[benchmark] = (issuesByBenchmark[benchmark] || 0) + 1;

      const planner = this.planners.get(benchmark);
      if (!planner) {
        continue;
      }

      const plan = planner.plan({
        issue,
        settings,
        config,
        report: snapshot.report,
        hookEventName: request.hookEventName,
      });
      if (!plan) {
        continue;
      }

      const signature = makeIssueSignature(issue);
      if (this.isCoolingDown(signature, snapshot.lineCount, settings.cooldownSteps)) {
        continue;
      }

      this.cooldowns.set(signature, snapshot.lineCount);

      alerts.push({
        id: makeAlertId(snapshot.sessionId, benchmark, signature),
        benchmark,
        severity: issue.severity,
        mode: settings.mode,
        summary: plan.summary,
        suggestion: plan.suggestion,
        prompt: plan.prompt,
        shouldBlock: plan.shouldBlock,
        hookEventName: request.hookEventName,
        tags: plan.tags,
        riskContext: snapshot.report
          ? {
              overallRisk: snapshot.report.risk.overallRisk,
              controlPreservation: snapshot.report.controlPreservation.score,
              autonomyLevel: snapshot.report.executionGuidance.autonomyLevel,
              guidanceActionTypes: snapshot.report.executionGuidance.recommendedActions.map(
                (action) => action.type
              ),
            }
          : undefined,
        sourceIssue: issue,
      });
    }

    const injections = this.remediationEngine.buildInjections(alerts, config, snapshot.report);
    const guidanceActions = snapshot.report?.executionGuidance.recommendedActions || [];
    const alertBlockReasons = alerts
      .filter((alert) => this.shouldBlockAlert(alert, request.hookEventName, config))
      .map((alert) => `${alert.benchmark}: ${alert.summary}`);
    const reportBlockReasons = this.buildReportBlockReasons(snapshot.report, request.hookEventName, config);
    const shouldBlock = alertBlockReasons.length > 0 || reportBlockReasons.length > 0;
    const blockReasons = [...alertBlockReasons, ...reportBlockReasons];
    const statePath = this.writeSessionState(snapshot, alerts, injections, shouldBlock, blockReasons, issuesByBenchmark, config);

    return {
      sessionId: snapshot.sessionId,
      transcriptPath: snapshot.transcriptPath,
      lineCount: snapshot.lineCount,
      alerts,
      injections,
      report: snapshot.report,
      guidanceActions,
      shouldBlock,
      blockReasons,
      detectorErrors: snapshot.detectorErrors,
      issuesByBenchmark,
      statePath,
    };
  }

  private isCoolingDown(signature: string, lineCount: number, cooldownSteps: number): boolean {
    if (!this.cooldowns.has(signature)) {
      return false;
    }

    const lastLineCount = this.cooldowns.get(signature) as number;
    return lineCount - lastLineCount <= cooldownSteps;
  }

  private shouldBlockAlert(
    alert: GuardAlert,
    hookEventName: string | undefined,
    config: GuardConfig
  ): boolean {
    if (!alert.shouldBlock) {
      return false;
    }

    if (hookEventName === 'PreToolUse' && !config.runtime.actions.blockHighRiskPreToolUse) {
      return false;
    }

    return alert.severity === Severity.Error;
  }

  private buildReportBlockReasons(
    report: GuardAnalysisResult['report'],
    hookEventName: string | undefined,
    config: GuardConfig
  ): string[] {
    if (!report) {
      return [];
    }

    if (hookEventName === 'PreToolUse' && !config.runtime.actions.blockHighRiskPreToolUse) {
      return [];
    }

    const blockableActions = report.executionGuidance.recommendedActions.filter((action) =>
      action.type === 'request-confirmation' || action.type === 'handoff'
    );
    const shouldEscalate =
      report.risk.overallRisk >= report.risk.model.errorThreshold &&
      report.controlPreservation.score < 0.55;

    if (!shouldEscalate || blockableActions.length === 0) {
      return [];
    }

    return blockableActions.map((action) =>
      `report:${action.type}: ${action.reason} (overallRisk=${report.risk.overallRisk.toFixed(2)}, controlPreservation=${report.controlPreservation.score.toFixed(2)})`
    );
  }

  private writeSessionState(
    snapshot: Awaited<ReturnType<RuntimeIssueSource['analyzeSession']>>,
    alerts: GuardAlert[],
    injections: GuardAnalysisResult['injections'],
    shouldBlock: boolean,
    blockReasons: string[],
    issuesByBenchmark: Record<string, number>,
    config: GuardConfig
  ): string | undefined {
    const stateDir = config.runtime.sources.sessionStateDir;
    if (!stateDir) {
      return undefined;
    }

    const resolvedDir = path.resolve(stateDir);
    fs.mkdirSync(resolvedDir, { recursive: true });
    const statePath = path.join(resolvedDir, `${snapshot.sessionId}.json`);
    const state = {
      sessionId: snapshot.sessionId,
      transcriptPath: snapshot.transcriptPath,
      updatedAt: new Date().toISOString(),
      lineCount: snapshot.lineCount,
      shouldBlock,
      blockReasons,
      detectorErrors: snapshot.detectorErrors,
      issuesByBenchmark,
      alertCount: alerts.length,
      alerts: alerts.map((alert) => ({
        id: alert.id,
        benchmark: alert.benchmark,
        severity: alert.severity,
        summary: alert.summary,
        suggestion: alert.suggestion,
        tags: alert.tags,
      })),
      injections,
      risk: snapshot.report?.risk,
      controlPreservation: snapshot.report?.controlPreservation,
      executionGuidance: snapshot.report?.executionGuidance,
      standardEventStream: snapshot.report?.analysis?.standardEventStream,
    };

    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
    return statePath;
  }
}
