import { BenchmarkTrajectoryMetadata } from '../adapters/BenchmarkTrajectoryLoader';
import { EvaluationReport } from '../types/evaluation.types';
import { mean, sampleStdDev, spearman } from './Stats';
import { ScorecardOptions, computeTrajectoryScorecard } from './ProcCtrlScorecard';

export const OBSERVED_DEFECT_METRICS = [
  'ghostContext',
  'oversizedRules',
  'thrashing',
  'duplicateStep',
  'toolCallChain',
  'deadStep',
  'longChain',
  'wrapperWorkflow',
  'contextCoupling',
  'inconsistentToolInterface',
  'weakTool',
] as const;

export type ObservedDefectMetric = typeof OBSERVED_DEFECT_METRICS[number];

export interface ObservedTrajectoryRecord {
  variant: string;
  benchmark: string;
  source: string;
  outcomeMetric: 'successRate' | 'testPassRate';
  taskId: string;
  trialId: string;
  runName?: string;
  status?: string;
  success: boolean | null;
  tokens: number | null;
  costUsd: number | null;
  rawPath: string;
  reportPath?: string;
  totalWarnings: number;
  totalErrors: number;
  overallRisk: number;
  averagePosteriorRisk: number;
  warningFindings: number;
  errorFindings: number;
  controlPreservation: number;
  controlLevel: string;
  interpretability: number;
  interruptibility: number;
  corrigibility: number;
  reversibility: number;
  handoffAwareness: number;
  autonomyLevel: number;
  recommendedActions: string[];
  taskCompletionRate: number;
  outputExecutability: number;
  postModificationVerificationRate: number;
  analyzedSteps: number;
  totalEvents: number;
  /**
   * ProcCtrlBench 记分卡（论文 3.4 / 3.5 节）。
   * Q 维度分按论文分类学计算，注意 longChain 计入 Qtool 而非 Qwf。
   */
  qCtx: number;
  qTool: number;
  qWf: number;
  qEco: number;
  qDef: number;
  pb: number;
  /** 计算 pb 时使用的 eta，写入记录以便产出可追溯 */
  pbEta: number;
  /** 逐缺陷后验风险 p_j，供缺陷间相关矩阵与校准分析使用 */
  ghostContextPosteriorRisk: number;
  oversizedRulesPosteriorRisk: number;
  thrashingPosteriorRisk: number;
  duplicateStepPosteriorRisk: number;
  toolCallChainPosteriorRisk: number;
  deadStepPosteriorRisk: number;
  longChainPosteriorRisk: number;
  wrapperWorkflowPosteriorRisk: number;
  contextCouplingPosteriorRisk: number;
  inconsistentToolInterfacePosteriorRisk: number;
  weakToolPosteriorRisk: number;
  ghostContextWarnings: number;
  ghostContextErrors: number;
  ghostContextTriggered: boolean;
  oversizedRulesWarnings: number;
  oversizedRulesErrors: number;
  oversizedRulesTriggered: boolean;
  thrashingWarnings: number;
  thrashingErrors: number;
  thrashingTriggered: boolean;
  duplicateStepWarnings: number;
  duplicateStepErrors: number;
  duplicateStepTriggered: boolean;
  toolCallChainWarnings: number;
  toolCallChainErrors: number;
  toolCallChainTriggered: boolean;
  deadStepWarnings: number;
  deadStepErrors: number;
  deadStepTriggered: boolean;
  longChainWarnings: number;
  longChainErrors: number;
  longChainTriggered: boolean;
  wrapperWorkflowWarnings: number;
  wrapperWorkflowErrors: number;
  wrapperWorkflowTriggered: boolean;
  contextCouplingWarnings: number;
  contextCouplingErrors: number;
  contextCouplingTriggered: boolean;
  inconsistentToolInterfaceWarnings: number;
  inconsistentToolInterfaceErrors: number;
  inconsistentToolInterfaceTriggered: boolean;
  weakToolWarnings: number;
  weakToolErrors: number;
  weakToolTriggered: boolean;
}

export interface ObservedBenchmarkSummaryRow {
  variant: string;
  benchmark: string;
  outcomeMetric: 'successRate' | 'testPassRate';
  sampleCount: number;
  observedOutcomeCount: number;
  outcomeRate: number;
  meanTokens: number;
  meanCostUsd: number;
  recoveryAfterErrorRate: number;
  meanWarnings: number;
  meanErrors: number;
  meanOverallRisk: number;
  meanAveragePosteriorRisk: number;
  meanControlPreservation: number;
  meanInterpretability: number;
  meanHandoffAwareness: number;
  meanAutonomyLevel: number;
  meanTaskCompletionRate: number;
  meanOutputExecutability: number;
  meanPostModificationVerificationRate: number;
}

export interface DefectFailureCorrelationRow {
  benchmark: string;
  variant: string;
  metric: ObservedDefectMetric;
  sampleCount: number;
  observedOutcomeCount: number;
  triggerCount: number;
  triggerRate: number;
  failureRateWhenTriggered: number;
  failureRateWhenNotTriggered: number;
  spearmanRho: number;
}

export interface SweControlSummaryRow {
  variant: string;
  benchmark: string;
  sampleCount: number;
  observedOutcomeCount: number;
  cpMean: number;
  cpStdDev: number;
  interpretabilityMean: number;
  handoffAwarenessMean: number;
  fragileSuccessRate: number;
}

export function reportToObservedTrajectoryRecord(
  metadata: BenchmarkTrajectoryMetadata,
  report: EvaluationReport,
  options?: {
    variant?: string;
    reportPath?: string;
    /** 记分卡参数（eta / 维度权重）；缺省时使用 ProcCtrlScorecard 的默认值 */
    scorecard?: ScorecardOptions;
  }
): ObservedTrajectoryRecord {
  const variant = options?.variant || 'observed-public-run';
  const outcomeMetric = resolveOutcomeMetric(metadata.benchmark);
  const scorecard = computeTrajectoryScorecard(report, options?.scorecard);

  const ghostContext = report.dimensions.contextManagement.details.ghostContext;
  const oversizedRules = report.dimensions.contextManagement.details.oversizedRules;
  const thrashing = report.dimensions.contextManagement.details.thrashing;
  const duplicateStep = report.dimensions.toolUseEfficiency.details.duplicateStep;
  const toolCallChain = report.dimensions.toolUseEfficiency.details.toolCallChain;
  const deadStep = report.dimensions.toolUseEfficiency.details.deadStep;
  const longChain = report.dimensions.workflowArchitecture.details.longChain;
  const wrapperWorkflow = report.dimensions.workflowArchitecture.details.wrapperWorkflow;
  const contextCoupling = report.dimensions.workflowArchitecture.details.contextCoupling;
  const inconsistentToolInterface = report.dimensions.toolEcosystemConsistency.details.inconsistentToolInterface;
  const weakTool = report.dimensions.toolEcosystemConsistency.details.weakTool;

  return {
    variant,
    benchmark: metadata.benchmark,
    source: metadata.source,
    outcomeMetric,
    taskId: metadata.taskId,
    trialId: metadata.trialId || 'single',
    runName: metadata.runName,
    status: metadata.status,
    success: typeof metadata.success === 'boolean' ? metadata.success : null,
    tokens: toNullableNumber(metadata.tokens),
    costUsd: toNullableNumber(metadata.costUsd),
    rawPath: metadata.rawPath,
    reportPath: options?.reportPath,
    totalWarnings: report.summary.totalWarnings,
    totalErrors: report.summary.totalErrors,
    overallRisk: report.risk.overallRisk,
    averagePosteriorRisk: report.risk.averagePosteriorRisk,
    warningFindings: report.risk.warningFindings,
    errorFindings: report.risk.errorFindings,
    controlPreservation: report.controlPreservation.score,
    controlLevel: report.controlPreservation.level,
    interpretability: report.controlPreservation.metrics.interpretability,
    interruptibility: report.controlPreservation.metrics.interruptibility,
    corrigibility: report.controlPreservation.metrics.corrigibility,
    reversibility: report.controlPreservation.metrics.reversibility,
    handoffAwareness: report.controlPreservation.metrics.handoffAwareness,
    autonomyLevel: report.executionGuidance.autonomyLevel,
    recommendedActions: report.executionGuidance.recommendedActions.map((action) => action.type),
    taskCompletionRate: report.dimensions.taskOutcome.details.taskCompletionRate,
    outputExecutability: report.dimensions.taskOutcome.details.outputExecutability,
    postModificationVerificationRate: report.dimensions.taskOutcome.details.postModificationVerificationRate,
    analyzedSteps: report.analysis?.contextChains?.analyzedSteps || 0,
    totalEvents: report.analysis?.standardEventStream?.totalEvents || 0,
    qCtx: scorecard.dimensionQuality.contextManagement,
    qTool: scorecard.dimensionQuality.toolUseEfficiency,
    qWf: scorecard.dimensionQuality.workflowArchitecture,
    qEco: scorecard.dimensionQuality.toolEcosystemConsistency,
    qDef: scorecard.qDef,
    pb: scorecard.pb,
    pbEta: scorecard.eta,
    ghostContextPosteriorRisk: scorecard.defectRisks.ghostContext,
    oversizedRulesPosteriorRisk: scorecard.defectRisks.oversizedRules,
    thrashingPosteriorRisk: scorecard.defectRisks.thrashing,
    duplicateStepPosteriorRisk: scorecard.defectRisks.duplicateStep,
    toolCallChainPosteriorRisk: scorecard.defectRisks.toolCallChain,
    deadStepPosteriorRisk: scorecard.defectRisks.deadStep,
    longChainPosteriorRisk: scorecard.defectRisks.longChain,
    wrapperWorkflowPosteriorRisk: scorecard.defectRisks.wrapperWorkflow,
    contextCouplingPosteriorRisk: scorecard.defectRisks.contextCoupling,
    inconsistentToolInterfacePosteriorRisk: scorecard.defectRisks.inconsistentToolInterface,
    weakToolPosteriorRisk: scorecard.defectRisks.weakTool,
    ghostContextWarnings: ghostContext.warnings,
    ghostContextErrors: ghostContext.errors,
    ghostContextTriggered: isTriggered(ghostContext),
    oversizedRulesWarnings: oversizedRules.warnings,
    oversizedRulesErrors: oversizedRules.errors,
    oversizedRulesTriggered: isTriggered(oversizedRules),
    thrashingWarnings: thrashing.warnings,
    thrashingErrors: thrashing.errors,
    thrashingTriggered: isTriggered(thrashing),
    duplicateStepWarnings: duplicateStep.warnings,
    duplicateStepErrors: duplicateStep.errors,
    duplicateStepTriggered: isTriggered(duplicateStep),
    toolCallChainWarnings: toolCallChain.warnings,
    toolCallChainErrors: toolCallChain.errors,
    toolCallChainTriggered: isTriggered(toolCallChain),
    deadStepWarnings: deadStep.warnings,
    deadStepErrors: deadStep.errors,
    deadStepTriggered: isTriggered(deadStep),
    longChainWarnings: longChain.warnings,
    longChainErrors: longChain.errors,
    longChainTriggered: isTriggered(longChain),
    wrapperWorkflowWarnings: wrapperWorkflow.warnings,
    wrapperWorkflowErrors: wrapperWorkflow.errors,
    wrapperWorkflowTriggered: isTriggered(wrapperWorkflow),
    contextCouplingWarnings: contextCoupling.warnings,
    contextCouplingErrors: contextCoupling.errors,
    contextCouplingTriggered: isTriggered(contextCoupling),
    inconsistentToolInterfaceWarnings: inconsistentToolInterface.warnings,
    inconsistentToolInterfaceErrors: inconsistentToolInterface.errors,
    inconsistentToolInterfaceTriggered: isTriggered(inconsistentToolInterface),
    weakToolWarnings: weakTool.warnings,
    weakToolErrors: weakTool.errors,
    weakToolTriggered: isTriggered(weakTool),
  };
}

export function aggregateObservedBenchmarkSummaries(
  records: ObservedTrajectoryRecord[]
): ObservedBenchmarkSummaryRow[] {
  const groups = groupBy(records, (record) => `${record.variant}::${record.benchmark}`);
  return [...groups.entries()]
    .map(([_, scoped]) => {
      const successValues = scoped
        .map((record) => record.success)
        .filter((value): value is boolean => typeof value === 'boolean');
      const withError = scoped.filter((record) => record.errorFindings > 0);
      const recoveryValues = withError
        .map((record) => record.success)
        .filter((value): value is boolean => typeof value === 'boolean');

      return {
        variant: scoped[0].variant,
        benchmark: scoped[0].benchmark,
        outcomeMetric: scoped[0].outcomeMetric,
        sampleCount: scoped.length,
        observedOutcomeCount: successValues.length,
        outcomeRate: mean(successValues.map((value) => (value ? 1 : 0))),
        meanTokens: meanNullable(scoped.map((record) => record.tokens)),
        meanCostUsd: meanNullable(scoped.map((record) => record.costUsd)),
        recoveryAfterErrorRate: mean(recoveryValues.map((value) => (value ? 1 : 0))),
        meanWarnings: mean(scoped.map((record) => record.totalWarnings)),
        meanErrors: mean(scoped.map((record) => record.totalErrors)),
        meanOverallRisk: mean(scoped.map((record) => record.overallRisk)),
        meanAveragePosteriorRisk: mean(scoped.map((record) => record.averagePosteriorRisk)),
        meanControlPreservation: mean(scoped.map((record) => record.controlPreservation)),
        meanInterpretability: mean(scoped.map((record) => record.interpretability)),
        meanHandoffAwareness: mean(scoped.map((record) => record.handoffAwareness)),
        meanAutonomyLevel: mean(scoped.map((record) => record.autonomyLevel)),
        meanTaskCompletionRate: mean(scoped.map((record) => record.taskCompletionRate)),
        meanOutputExecutability: mean(scoped.map((record) => record.outputExecutability)),
        meanPostModificationVerificationRate: mean(
          scoped.map((record) => record.postModificationVerificationRate)
        ),
      };
    })
    .sort(compareBy(['variant', 'benchmark']));
}

export function computeDefectFailureCorrelations(
  records: ObservedTrajectoryRecord[],
  benchmark = 'all'
): DefectFailureCorrelationRow[] {
  const scoped = benchmark === 'all'
    ? records
    : records.filter((record) => record.benchmark === benchmark);
  const variants = unique(scoped.map((record) => record.variant));
  const rows: DefectFailureCorrelationRow[] = [];

  for (const variant of variants) {
    const variantScoped = scoped.filter((record) => record.variant === variant);
    const observedOutcomeCount = variantScoped.filter((record) => record.success !== null).length;

    for (const metric of OBSERVED_DEFECT_METRICS) {
      const triggerSeries = variantScoped.map((record) => (record[`${metric}Triggered`] ? 1 : 0));
      const outcomeSeries = variantScoped
        .filter((record) => record.success !== null)
        .map((record) => (record.success ? 0 : 1));
      const comparable = variantScoped.filter((record) => record.success !== null);
      const triggerComparable = comparable.map((record) => (record[`${metric}Triggered`] ? 1 : 0));
      const triggered = comparable.filter((record) => record[`${metric}Triggered`]);
      const notTriggered = comparable.filter((record) => !record[`${metric}Triggered`]);

      rows.push({
        benchmark,
        variant,
        metric,
        sampleCount: variantScoped.length,
        observedOutcomeCount,
        triggerCount: triggerSeries.reduce((sum, value) => sum + value, 0),
        triggerRate: mean(triggerSeries),
        failureRateWhenTriggered: mean(
          triggered.map((record) => (record.success ? 0 : 1))
        ),
        failureRateWhenNotTriggered: mean(
          notTriggered.map((record) => (record.success ? 0 : 1))
        ),
        spearmanRho: spearman(triggerComparable, outcomeSeries),
      });
    }
  }

  return rows.sort(compareBy(['benchmark', 'variant', 'metric']));
}

export function computeSweControlSummary(
  records: ObservedTrajectoryRecord[],
  benchmark = 'swe-bench-verified'
): SweControlSummaryRow[] {
  const scoped = records.filter((record) => record.benchmark === benchmark);
  const variants = unique(scoped.map((record) => record.variant));

  return variants.map((variant) => {
    const variantScoped = scoped.filter((record) => record.variant === variant);
    const cpValues = variantScoped.map((record) => record.controlPreservation);
    const successValues = variantScoped
      .map((record) => record.success)
      .filter((value): value is boolean => typeof value === 'boolean');

    return {
      variant,
      benchmark,
      sampleCount: variantScoped.length,
      observedOutcomeCount: successValues.length,
      cpMean: mean(cpValues),
      cpStdDev: sampleStdDev(cpValues),
      interpretabilityMean: mean(variantScoped.map((record) => record.interpretability)),
      handoffAwarenessMean: mean(variantScoped.map((record) => record.handoffAwareness)),
      fragileSuccessRate: computeFragileSuccessRate(variantScoped),
    };
  }).sort(compareBy(['variant', 'benchmark']));
}

/**
 * 数据集内相对定义的脆弱成功率：成功但 CP 低于本批样本均值，且触发了
 * longChain / deadStep。
 *
 * 注意适用边界：阈值随所传入样本的均值漂移，因此该指标只适合在**同一批**
 * 样本内部做描述性分析，不能用于跨系统横向比较。论文 Table 2 / Table 4 的
 * 脆弱成功率请使用 ProcCtrlScorecard.isFragileSuccess 的绝对阈值定义。
 */
export function computeFragileSuccessRate(records: ObservedTrajectoryRecord[]): number {
  const successful = records.filter((record) => record.success === true);
  if (successful.length === 0) {
    return 0;
  }

  const averageCp = mean(records.map((record) => record.controlPreservation));
  const fragile = successful.filter(
    (record) => record.controlPreservation < averageCp && (record.longChainTriggered || record.deadStepTriggered)
  );
  return fragile.length / successful.length;
}

export function resolveOutcomeMetric(benchmark: string): 'successRate' | 'testPassRate' {
  return benchmark === 'swe-bench-verified' ? 'testPassRate' : 'successRate';
}

function isTriggered(metricSummary: { warnings: number; errors: number }): boolean {
  return metricSummary.warnings > 0 || metricSummary.errors > 0;
}

function toNullableNumber(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function meanNullable(values: Array<number | null>): number {
  return mean(values.filter((value): value is number => typeof value === 'number'));
}

function groupBy<T>(values: T[], keyFn: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keyFn(value);
    const current = groups.get(key);
    if (current) {
      current.push(value);
    } else {
      groups.set(key, [value]);
    }
  }
  return groups;
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function compareBy<T extends Record<string, any>>(keys: string[]) {
  return (left: T, right: T) => {
    for (const key of keys) {
      if (left[key] < right[key]) {
        return -1;
      }
      if (left[key] > right[key]) {
        return 1;
      }
    }
    return 0;
  };
}

