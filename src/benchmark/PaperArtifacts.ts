import { FlatAnnotationRow } from '../adapters/AnnotationLoader';
import {
  DetectionSample,
  bootstrapRankStability,
  compareCalibrationDetailed,
  computeAgreementStats,
  computeCorrelationMatrix,
  computeDetectionMetrics,
  defectFailureAssociation,
  estimateHardThresholdMapping,
} from './PaperMetrics';
import {
  PROCCTRL_DEFECT_KEYS,
  PROCCTRL_DIMENSION_KEYS,
  PROCCTRL_TAXONOMY,
  ProcCtrlDefectKey,
  ProcCtrlDimensionKey,
  ScorecardOptions,
  SystemScorecardInput,
  aggregateScenarioScorecard,
  aggregateSystemScorecard,
  computeInfraQuality,
  computePolicyQuality,
  defectSpec,
  defectsOfDimension,
  isFragileSuccess,
  sweepEtaSensitivity,
} from './ProcCtrlScorecard';
import { ObservedTrajectoryRecord } from './ObservedBenchmarkExperiments';
import { Rng, bootstrapCI, createSeededRng, rank } from './Stats';

/**
* Assemble trajectory records and human annotations into paper v8 table and figure data.
 *
 * Covers Tables 1 / 2 / 4 / 5 / 6 / 7 / 8 / 10 / 12 / 13 / 14 / 15 and
 * Figures 2a / 3 / 4 / 5 / 7 / 8.
 *
 * Function names retain the historical Table 1-7 naming, but `paperRef` and output file names
 * follow paper v8; aliases such as `buildTable8` / `buildTable6Outcome` are provided.
 *
 * Key constraint: any output that depends on human annotations returns blocked with
 * a reason when annotations are missing, never an empty table or placeholder values.
 */

export type ArtifactStatus = 'generated' | 'blocked';

export interface ArtifactOutcome<T> {
  /** Output identifier, also used as the filename prefix */
  id: string;
  /** Corresponding table or figure number in the paper */
  paperRef: string;
  status: ArtifactStatus;
  /** Describes what is missing when blocked */
  reason?: string;
  rows: T[];
}

function generated<T>(id: string, paperRef: string, rows: T[]): ArtifactOutcome<T> {
  return { id, paperRef, status: 'generated', rows };
}

function blocked<T>(id: string, paperRef: string, reason: string): ArtifactOutcome<T> {
  return { id, paperRef, status: 'blocked', reason, rows: [] };
}

/** System identifier: variant stores the agent-model configuration name in trajectory records */
export function systemOf(record: ObservedTrajectoryRecord): string {
  return record.variant;
}

/**
 * Sample join key.
 *
 * Prefer the original trajectory path, which is unique and stable; fall back to the
 * benchmark/task/trial combination when absent. Annotation sets and detection outputs
 * must generate keys using the same rule or they cannot be aligned.
 */
export function caseKeyOfRecord(record: ObservedTrajectoryRecord): string {
  if (record.rawPath) {
    return record.rawPath;
  }
  return `${record.benchmark}/${record.taskId}/${record.trialId || 'single'}`;
}

export function caseKeyOfAnnotation(row: FlatAnnotationRow): string {
  return row.rawPath || row.caseId;
}

const TRIGGERED_FIELDS: Record<ProcCtrlDefectKey, keyof ObservedTrajectoryRecord> = {
  ghostContext: 'ghostContextTriggered',
  oversizedRules: 'oversizedRulesTriggered',
  thrashing: 'thrashingTriggered',
  duplicateStep: 'duplicateStepTriggered',
  toolCallChain: 'toolCallChainTriggered',
  deadStep: 'deadStepTriggered',
  longChain: 'longChainTriggered',
  wrapperWorkflow: 'wrapperWorkflowTriggered',
  contextCoupling: 'contextCouplingTriggered',
  inconsistentToolInterface: 'inconsistentToolInterfaceTriggered',
  weakTool: 'weakToolTriggered',
};

const POSTERIOR_RISK_FIELDS: Record<ProcCtrlDefectKey, keyof ObservedTrajectoryRecord> = {
  ghostContext: 'ghostContextPosteriorRisk',
  oversizedRules: 'oversizedRulesPosteriorRisk',
  thrashing: 'thrashingPosteriorRisk',
  duplicateStep: 'duplicateStepPosteriorRisk',
  toolCallChain: 'toolCallChainPosteriorRisk',
  deadStep: 'deadStepPosteriorRisk',
  longChain: 'longChainPosteriorRisk',
  wrapperWorkflow: 'wrapperWorkflowPosteriorRisk',
  contextCoupling: 'contextCouplingPosteriorRisk',
  inconsistentToolInterface: 'inconsistentToolInterfacePosteriorRisk',
  weakTool: 'weakToolPosteriorRisk',
};

export function defectTriggered(record: ObservedTrajectoryRecord, defect: ProcCtrlDefectKey): boolean {
  return Boolean(record[TRIGGERED_FIELDS[defect]]);
}

export function defectPosteriorRisk(
  record: ObservedTrajectoryRecord,
  defect: ProcCtrlDefectKey
): number {
  const value = record[POSTERIOR_RISK_FIELDS[defect]];
  return typeof value === 'number' ? value : 0;
}

export function defectRisksOfRecord(
  record: ObservedTrajectoryRecord
): Partial<Record<ProcCtrlDefectKey, number>> {
  if (record.defectRisks) {
    return record.defectRisks;
  }
  return {
    ghostContext: record.ghostContextPosteriorRisk,
    oversizedRules: record.oversizedRulesPosteriorRisk,
    thrashing: record.thrashingPosteriorRisk,
    duplicateStep: record.duplicateStepPosteriorRisk,
    toolCallChain: record.toolCallChainPosteriorRisk,
    deadStep: record.deadStepPosteriorRisk,
    longChain: record.longChainPosteriorRisk,
    wrapperWorkflow: record.wrapperWorkflowPosteriorRisk,
    contextCoupling: record.contextCouplingPosteriorRisk,
    inconsistentToolInterface: record.inconsistentToolInterfacePosteriorRisk,
    weakTool: record.weakToolPosteriorRisk,
  };
}

/** Convert a trajectory record into the input required for scorecard aggregation */
export function recordToScorecardInput(record: ObservedTrajectoryRecord): SystemScorecardInput {
  return {
    system: systemOf(record),
    benchmark: record.benchmark,
    success: record.success,
    qDef: record.qDef,
    dimensionQuality: {
      contextManagement: record.qCtx,
      toolUseEfficiency: record.qTool,
      workflowArchitecture: record.qWf,
      toolEcosystemConsistency: record.qEco,
    },
    cp: record.controlPreservation,
    controlSubdimensions: {
      interpretability: record.interpretability,
      interruptibility: record.interruptibility,
      correctability: record.corrigibility,
      reversibility: record.reversibility,
      authorityHandoff: record.handoffAwareness,
    },
    defectRisks: defectRisksOfRecord(record),
    errorFindings: record.errorFindings,
  };
}

function groupBySystem(records: ObservedTrajectoryRecord[]): Map<string, ObservedTrajectoryRecord[]> {
  const groups = new Map<string, ObservedTrajectoryRecord[]>();
  for (const record of records) {
    const key = systemOf(record);
    const bucket = groups.get(key);
    if (bucket) bucket.push(record);
    else groups.set(key, [record]);
  }
  return groups;
}

export type PaperSplitName = 'development' | 'calibration' | 'evaluation';

export interface SplitAwareOptions {
  /** caseId or rawPath -> split; produced by scripts/export-annotation-split.ts */
  splitByCaseId?: Record<string, PaperSplitName>;
  /** Keep only this split; no filtering when omitted */
  split?: PaperSplitName;
}

function splitOfAnnotationRow(
  row: FlatAnnotationRow,
  splitByCaseId?: Record<string, PaperSplitName>
): PaperSplitName | undefined {
  if (!splitByCaseId) return undefined;
  return splitByCaseId[row.caseId] ?? (row.rawPath ? splitByCaseId[row.rawPath] : undefined);
}

function splitOfRecord(
  record: ObservedTrajectoryRecord,
  splitByCaseId?: Record<string, PaperSplitName>
): PaperSplitName | undefined {
  if (!splitByCaseId) return undefined;
  return (
    splitByCaseId[caseKeyOfRecord(record)] ??
    splitByCaseId[`${record.benchmark}/${record.taskId}/${record.trialId || 'single'}`]
  );
}

export function filterRecordsBySplit(
  records: ObservedTrajectoryRecord[],
  options?: SplitAwareOptions
): ObservedTrajectoryRecord[] {
  if (!options?.split || !options.splitByCaseId) return records;
  return records.filter((record) => splitOfRecord(record, options.splitByCaseId) === options.split);
}

export function filterAnnotationRowsBySplit(
  rows: FlatAnnotationRow[],
  options?: SplitAwareOptions
): FlatAnnotationRow[] {
  if (!options?.split || !options.splitByCaseId) return rows;
  return rows.filter(
    (row) => splitOfAnnotationRow(row, options.splitByCaseId) === options.split
  );
}

// ---------------------------------------------------------------------------
// Table 1: defect instantiation performance + dimension calibration quality
// ---------------------------------------------------------------------------

export interface Table1DetectionRow {
  group: string;
  defect: string;
  abbreviation: string;
  trigger: number;
  precision: number;
  recall: number;
  f1: number;
  ap: number;
  auroc: number;
  support: number;
  positives: number;
}

export interface Table1CalibrationRow {
  dimension: string;
  dimensionSymbol: string;
  hardEce: number;
  bayesEce: number;
  improvement: number;
  support: number;
}

export interface Table1Result {
  detection: ArtifactOutcome<Table1DetectionRow>;
  calibration: ArtifactOutcome<Table1CalibrationRow>;
  /** Reliability curve data for Figure 7 */
  reliability: ArtifactOutcome<ReliabilityRow>;
}

export interface ReliabilityRow {
  dimension: string;
  variant: 'hard' | 'bayes';
  bucketIndex: number;
  lowerBound: number;
  upperBound: number;
  sampleCount: number;
  meanPredictedRisk: number;
  observedRate: number;
  absoluteGap: number;
}

const DIMENSION_LABELS: Record<ProcCtrlDimensionKey, string> = {
  contextManagement: 'Context Management',
  toolUseEfficiency: 'Tool-Use Efficiency',
  workflowArchitecture: 'Workflow Architecture',
  toolEcosystemConsistency: 'Tool Ecosystem',
};

const DIMENSION_SYMBOL_LABELS: Record<ProcCtrlDimensionKey, string> = {
  contextManagement: 'Qctx',
  toolUseEfficiency: 'Qtool',
  workflowArchitecture: 'Qwf',
  toolEcosystemConsistency: 'Qeco',
};

/**
 * Build Table 1 and Figure 7.
 *
 * Human annotations must provide y_j. When annotations are missing, all three outputs
 * are blocked. This preserves the original implementation's honest boundary while
 * expressing it structurally.
 */
export function buildTable1(
  records: ObservedTrajectoryRecord[],
  annotationRows: FlatAnnotationRow[]
): Table1Result {
  const missingAnnotations = annotationRows.length === 0;
  if (missingAnnotations) {
    const reason =
      'Process-level human annotations are required to evaluate detectors against ground truth. ' +
      'Provide an annotation set via --annotations (see docs/annotation_protocol.md).';
    return {
      detection: blocked('table1-defect-instantiation', 'Table 1 (left block)', reason),
      calibration: blocked('table1-calibration-ece', 'Table 1 (right block)', reason),
      reliability: blocked('fig7-reliability-diagram', 'Figure 7', reason),
    };
  }

  const recordByKey = new Map<string, ObservedTrajectoryRecord>();
  for (const record of records) {
    recordByKey.set(caseKeyOfRecord(record), record);
  }

  const samplesByDefect = new Map<ProcCtrlDefectKey, DetectionSample[]>();
  for (const key of PROCCTRL_DEFECT_KEYS) {
    samplesByDefect.set(key, []);
  }
  let unmatched = 0;

  for (const row of annotationRows) {
    const record = recordByKey.get(caseKeyOfAnnotation(row));
    if (!record) {
      unmatched++;
      continue;
    }
    samplesByDefect.get(row.defect)!.push({
      label: row.label,
      score: defectPosteriorRisk(record, row.defect),
      triggered: defectTriggered(record, row.defect),
    });
  }

  const matchedTotal = [...samplesByDefect.values()].reduce((sum, list) => sum + list.length, 0);
  if (matchedTotal === 0) {
    const reason =
      `None of the ${annotationRows.length} annotation rows could be matched to a trajectory record. ` +
      'Ensure the annotation set carries rawPath values (or caseIds) that match the evaluated trajectories.';
    return {
      detection: blocked('table1-defect-instantiation', 'Table 1 (left block)', reason),
      calibration: blocked('table1-calibration-ece', 'Table 1 (right block)', reason),
      reliability: blocked('fig7-reliability-diagram', 'Figure 7', reason),
    };
  }

  const detectionRows: Table1DetectionRow[] = [];
  for (const spec of PROCCTRL_TAXONOMY) {
    const samples = samplesByDefect.get(spec.key)!;
    if (samples.length === 0) {
      continue;
    }
    const metrics = computeDetectionMetrics(samples);
    detectionRows.push({
      group: DIMENSION_LABELS[spec.dimension],
      defect: spec.paperName,
      abbreviation: spec.abbreviation,
      trigger: metrics.triggerRate,
      precision: metrics.precision,
      recall: metrics.recall,
      f1: metrics.f1,
      ap: metrics.ap,
      auroc: metrics.auroc,
      support: metrics.support,
      positives: metrics.positives,
    });
  }

  const calibrationRows: Table1CalibrationRow[] = [];
  const reliabilityRows: ReliabilityRow[] = [];

  for (const dimension of PROCCTRL_DIMENSION_KEYS) {
    const dimensionSamples: Array<{ label: boolean; triggered: boolean; posteriorRisk: number }> = [];
    for (const defect of defectsOfDimension(dimension)) {
      for (const sample of samplesByDefect.get(defect)!) {
        dimensionSamples.push({
          label: sample.label,
          triggered: sample.triggered,
          posteriorRisk: sample.score,
        });
      }
    }
    if (dimensionSamples.length === 0) {
      continue;
    }

    const comparison = compareCalibrationDetailed(dimensionSamples, {
      binning: 'equal-mass',
      bucketCount: 10,
    });
    calibrationRows.push({
      dimension: DIMENSION_LABELS[dimension],
      dimensionSymbol: DIMENSION_SYMBOL_LABELS[dimension],
      hardEce: comparison.hardEce,
      bayesEce: comparison.bayesEce,
      improvement: comparison.improvement,
      support: comparison.support,
    });

    for (const [variant, buckets] of [
      ['hard', comparison.hardBuckets],
      ['bayes', comparison.bayesBuckets],
    ] as const) {
      for (const bucket of buckets) {
        reliabilityRows.push({
          dimension: DIMENSION_LABELS[dimension],
          variant,
          bucketIndex: bucket.index,
          lowerBound: bucket.lowerBound,
          upperBound: bucket.upperBound,
          sampleCount: bucket.sampleCount,
          meanPredictedRisk: bucket.meanPredictedRisk,
          observedRate: bucket.observedRate,
          absoluteGap: bucket.absoluteGap,
        });
      }
    }
  }

  // Overall row across all samples, corresponding to the last row of Table 1
  const allSamples = [...samplesByDefect.values()].flat();
  const overall = compareCalibrationDetailed(
    allSamples.map((sample) => ({
      label: sample.label,
      triggered: sample.triggered,
      posteriorRisk: sample.score,
    })),
    { binning: 'equal-mass', bucketCount: 10 }
  );
  calibrationRows.push({
    dimension: 'Overall',
    dimensionSymbol: '-',
    hardEce: overall.hardEce,
    bayesEce: overall.bayesEce,
    improvement: overall.improvement,
    support: overall.support,
  });

  const detection = generated('table1-defect-instantiation', 'Table 1 (left block)', detectionRows);
  if (unmatched > 0) {
    detection.reason = `${unmatched} annotation row(s) had no matching trajectory record and were excluded.`;
  }

  const calibration = generated(
    'table1-calibration-ece',
    'Table 1 (right block)',
    calibrationRows
  );
  calibration.reason =
    'ECE uses 10 equal-mass bins. Hard-threshold ECE uses 0/1 predictions here; ' +
    'dev-split empirical p_pos/p_neg mapping is available through buildTable13 with a dev split.';

  return {
    detection,
    calibration,
    reliability: generated('fig7-reliability-diagram', 'Figure 7', reliabilityRows),
  };
}

// ---------------------------------------------------------------------------
// Table 2 / Table 12: cross-system scorecards and control-preservation breakdown
// ---------------------------------------------------------------------------

export interface Table2Row {
  system: string;
  sampleCount: number;
  observedOutcomeCount: number;
  pb: number;
  qCtx: number;
  qTool: number;
  qWf: number;
  qEco: number;
  cp: number;
  fragileSuccessRate: number;
  /** Per-source PB for the right block of Table 2; null when a source is absent */
  androidBench: number | null;
  terminalBench: number | null;
  sweBenchVerified: number | null;
  eta: number;
}

export function buildTable2(
  records: ObservedTrajectoryRecord[],
  options?: ScorecardOptions
): ArtifactOutcome<Table2Row> {
  if (records.length === 0) {
    return blocked(
      'table2-cross-system-scorecard',
      'Table 2',
      'No trajectory records were supplied. Run the offline evaluation first to produce trajectory-records.jsonl.'
    );
  }

  const rows: Table2Row[] = [];
  for (const [system, scoped] of groupBySystem(records)) {
    const inputs = scoped.map(recordToScorecardInput);
    const aggregated = aggregateSystemScorecard(system, inputs, options);
    const scenario = aggregateScenarioScorecard(system, inputs, options);
    const scenarioValue = (benchmark: string): number | null => {
      const value = scenario.byBenchmark[benchmark];
      return typeof value === 'number' ? value : null;
    };
    rows.push({
      system: aggregated.system,
      sampleCount: aggregated.sampleCount,
      observedOutcomeCount: aggregated.observedOutcomeCount,
      pb: aggregated.pb,
      qCtx: aggregated.qCtx,
      qTool: aggregated.qTool,
      qWf: aggregated.qWf,
      qEco: aggregated.qEco,
      cp: aggregated.cp,
      fragileSuccessRate: aggregated.fragileSuccessRate,
      androidBench: scenarioValue('android-bench'),
      terminalBench: scenarioValue('terminal-bench'),
      sweBenchVerified: scenarioValue('swe-bench-verified'),
      eta: aggregated.eta,
    });
  }

  rows.sort((left, right) => right.pb - left.pb);
  return generated('table2-cross-system-scorecard', 'Table 2', rows);
}

export interface Table7Row {
  system: string;
  interpretability: number;
  interruptibility: number;
  correctability: number;
  reversibility: number;
  authorityHandoff: number;
  cp: number;
}

/**
* Table 12: breakdown of the five control-preservation subdimensions.
 * Column names use the paper's terms (correctability / authorityHandoff), while the
 * internal fields remain corrigibility / handoffAwareness and are mapped in recordToScorecardInput.
 */
export function buildTable7(
  records: ObservedTrajectoryRecord[],
  options?: ScorecardOptions
): ArtifactOutcome<Table7Row> {
  if (records.length === 0) {
    return blocked('table12-control-subdimensions', 'Table 12', 'No trajectory records were supplied.');
  }

  const rows: Table7Row[] = [];
  for (const [system, scoped] of groupBySystem(records)) {
    const aggregated = aggregateSystemScorecard(system, scoped.map(recordToScorecardInput), options);
    rows.push({
      system: aggregated.system,
      interpretability: aggregated.interpretability,
      interruptibility: aggregated.interruptibility,
      correctability: aggregated.correctability,
      reversibility: aggregated.reversibility,
      authorityHandoff: aggregated.authorityHandoff,
      cp: aggregated.cp,
    });
  }

  rows.sort((left, right) => right.cp - left.cp);
  return generated('table12-control-subdimensions', 'Table 12', rows);
}

// ---------------------------------------------------------------------------
// Table 8: scenario scores
// ---------------------------------------------------------------------------

export interface Table3Row {
  system: string;
  overall: number;
  androidBench: number | null;
  terminalBench: number | null;
  sweBenchVerified: number | null;
  sampleCount: number;
}

const BENCHMARK_COLUMNS: Array<{ key: keyof Omit<Table3Row, 'system' | 'overall' | 'sampleCount'>; benchmark: string }> = [
  { key: 'androidBench', benchmark: 'android-bench' },
  { key: 'terminalBench', benchmark: 'terminal-bench' },
  { key: 'sweBenchVerified', benchmark: 'swe-bench-verified' },
];

export function buildTable3(
  records: ObservedTrajectoryRecord[],
  options?: ScorecardOptions
): ArtifactOutcome<Table3Row> {
  if (records.length === 0) {
    return blocked('table8-scenario-scores', 'Table 8', 'No trajectory records were supplied.');
  }

  const rows: Table3Row[] = [];
  for (const [system, scoped] of groupBySystem(records)) {
    const scenario = aggregateScenarioScorecard(system, scoped.map(recordToScorecardInput), options);
    const row: Table3Row = {
      system,
      overall: scenario.overall,
      androidBench: null,
      terminalBench: null,
      sweBenchVerified: null,
      sampleCount: scoped.length,
    };
    for (const column of BENCHMARK_COLUMNS) {
      const value = scenario.byBenchmark[column.benchmark];
      // null means this system has no samples from this source, distinct from a score of 0
      row[column.key] = typeof value === 'number' ? value : null;
    }
    rows.push(row);
  }

  rows.sort((left, right) => right.overall - left.overall);
  return generated('table8-scenario-scores', 'Table 8', rows);
}

// ---------------------------------------------------------------------------
// Table 6: outcome ranking vs ProcCtrlBench ranking
// ---------------------------------------------------------------------------

export interface Table4Row {
  system: string;
  outcomeScore: number;
  outcomeRank: number;
  pb: number;
  pbRank: number;
  /** outcomeRank - pbRank; a positive value means a better ProcCtrlBench ranking */
  rankShift: number;
  fragileSuccessRate: number;
  observedOutcomeCount: number;
}

/**
* Competition ranking: equal scores tie and share the same rank.
 * Table 6 contains tied ranks, so this implements that behavior explicitly.
 */
function competitionRanks(scores: number[]): number[] {
  const ordered = scores
    .map((score, index) => ({ score, index }))
    .sort((left, right) => right.score - left.score);

  const ranks = new Array<number>(scores.length);
  let currentRank = 1;
  for (let position = 0; position < ordered.length; position++) {
    if (position > 0 && ordered[position].score !== ordered[position - 1].score) {
      currentRank = position + 1;
    }
    ranks[ordered[position].index] = currentRank;
  }
  return ranks;
}

export function buildTable4(
  records: ObservedTrajectoryRecord[],
  options?: ScorecardOptions
): ArtifactOutcome<Table4Row> {
  const withOutcome = records.filter((record) => record.success !== null);
  if (withOutcome.length === 0) {
    return blocked(
      'table6-outcome-vs-procctrl',
      'Table 6',
      'No trajectory carries an endpoint outcome (success is null everywhere), so an outcome-based ranking cannot be computed.'
    );
  }

  const entries: Array<{ system: string; outcomeScore: number; pb: number; fragile: number; count: number }> = [];
  for (const [system, scoped] of groupBySystem(records)) {
    const scopedWithOutcome = scoped.filter((record) => record.success !== null);
    if (scopedWithOutcome.length === 0) {
      continue;
    }
    const inputs = scoped.map(recordToScorecardInput);
    const aggregated = aggregateSystemScorecard(system, inputs, options);
    const successCount = scopedWithOutcome.filter((record) => record.success === true).length;

    entries.push({
      system,
      outcomeScore: successCount / scopedWithOutcome.length,
      pb: aggregated.pb,
      fragile: aggregated.fragileSuccessRate,
      count: scopedWithOutcome.length,
    });
  }

  const outcomeRanks = competitionRanks(entries.map((entry) => entry.outcomeScore));
  const pbRanks = competitionRanks(entries.map((entry) => entry.pb));

  const rows: Table4Row[] = entries.map((entry, index) => ({
    system: entry.system,
    outcomeScore: entry.outcomeScore,
    outcomeRank: outcomeRanks[index],
    pb: entry.pb,
    pbRank: pbRanks[index],
    rankShift: outcomeRanks[index] - pbRanks[index],
    fragileSuccessRate: entry.fragile,
    observedOutcomeCount: entry.count,
  }));

  rows.sort((left, right) => left.pbRank - right.pbRank);
  const artifact = generated('table6-outcome-vs-procctrl', 'Table 6', rows);
  artifact.reason =
    'Outcome Score is instantiated as the endpoint success rate; the paper does not fully specify ' +
    'its normalized outcome composite.';
  return artifact;
}

// ---------------------------------------------------------------------------
// Table 7: annotation agreement
// ---------------------------------------------------------------------------

export interface Table5Row {
  defect: string;
  abbreviation: string;
  rawAgreement: number;
  cohensKappa: number;
  exemptionRate: number;
  adjudicationRate: number;
  support: number;
}

export function buildTable5(annotationRows: FlatAnnotationRow[]): ArtifactOutcome<Table5Row> {
  if (annotationRows.length === 0) {
    return blocked(
      'table7-annotation-agreement',
      'Table 7',
      'Annotation agreement requires a dual-annotated set; none was supplied via --annotations.'
    );
  }

  const rows: Table5Row[] = [];
  for (const spec of PROCCTRL_TAXONOMY) {
    const scoped = annotationRows.filter((row) => row.defect === spec.key);
    if (scoped.length === 0) {
      continue;
    }
    const stats = computeAgreementStats(
      scoped.map((row) => ({
        // Compute agreement before adjudication by collapsing ternary judgments into defect presence
        annotatorA: row.annotatorA === 'present',
        annotatorB: row.annotatorB === 'present',
        exempt: row.exempt,
        adjudicated: row.adjudicated,
      }))
    );
    rows.push({
      defect: spec.paperName,
      abbreviation: spec.abbreviation,
      rawAgreement: stats.rawAgreement,
      cohensKappa: stats.cohensKappa,
      exemptionRate: stats.exemptionRate,
      adjudicationRate: stats.adjudicationRate,
      support: stats.support,
    });
  }

  const overall = computeAgreementStats(
    annotationRows.map((row) => ({
      annotatorA: row.annotatorA === 'present',
      annotatorB: row.annotatorB === 'present',
      exempt: row.exempt,
      adjudicated: row.adjudicated,
    }))
  );
  rows.push({
    defect: 'Overall',
    abbreviation: '-',
    rawAgreement: overall.rawAgreement,
    cohensKappa: overall.cohensKappa,
    exemptionRate: overall.exemptionRate,
    adjudicationRate: overall.adjudicationRate,
    support: overall.support,
  });

  return generated('table7-annotation-agreement', 'Table 7', rows);
}

// ---------------------------------------------------------------------------
// Table 6 / Figure 5: bootstrap stability
// ---------------------------------------------------------------------------

export interface Table6Row {
  system: string;
  meanRank: number;
  rankStdDev: number;
  top1Frequency: number;
  top3Frequency: number;
  meanScore: number;
}

export interface BootstrapOptions extends ScorecardOptions {
  replicates?: number;
  seed?: number;
}

export function buildTable6(
  records: ObservedTrajectoryRecord[],
  options?: BootstrapOptions
): ArtifactOutcome<Table6Row> {
  if (records.length === 0) {
    return blocked('table10-bootstrap-rank-stability', 'Table 10', 'No trajectory records were supplied.');
  }

  const grouped = groupBySystem(records);
  if (grouped.size < 2) {
    return blocked(
      'table10-bootstrap-rank-stability',
      'Table 10',
      `Ranking stability needs at least two systems, found ${grouped.size} ` +
        '(use --variant to label each agent-model configuration distinctly).'
    );
  }

  const inputs = [...grouped.entries()].map(([system, scoped]) => {
    const byTask = new Map<string, number[]>();
    for (const record of scoped) {
      const taskKey = `${record.benchmark}/${record.taskId}`;
      const bucket = byTask.get(taskKey) ?? [];
      bucket.push(record.pb);
      byTask.set(taskKey, bucket);
    }
    const taskKeys = [...byTask.keys()].sort();
    return {
      system,
      taskKeys,
      scores: taskKeys.map(
        (taskKey) =>
          byTask.get(taskKey)!.reduce((sum, value) => sum + value, 0) /
          byTask.get(taskKey)!.length
      ),
      strata: taskKeys.map((taskKey) => taskKey.split('/')[0]),
    };
  });

  const stability = bootstrapRankStability(inputs, {
    replicates: options?.replicates ?? 10000,
    rng: createSeededRng(options?.seed ?? 20270101),
  });

  const rows = stability
    .map((row) => ({
      system: row.system,
      meanRank: row.meanRank,
      rankStdDev: row.rankStdDev,
      top1Frequency: row.top1Frequency,
      top3Frequency: row.top3Frequency,
      meanScore: row.meanScore,
    }))
    .sort((left, right) => left.meanRank - right.meanRank);

  return generated('table10-bootstrap-rank-stability', 'Table 10', rows);
}

export interface Fig5Row {
  system: string;
  metric: 'PB' | 'CP' | 'Qctx' | 'Qtool' | 'Qwf' | 'Qeco';
  mean: number;
  ciLow: number;
  ciHigh: number;
  sampleCount: number;
}

/** Figure 5: 95% bootstrap confidence intervals for each system's PB, CP, and four dimension scores */
export function buildFig5(
  records: ObservedTrajectoryRecord[],
  options?: BootstrapOptions
): ArtifactOutcome<Fig5Row> {
  if (records.length === 0) {
    return blocked('fig5-bootstrap-ci', 'Figure 5', 'No trajectory records were supplied.');
  }

  const replicates = options?.replicates ?? 10000;
  const rng: Rng = createSeededRng(options?.seed ?? 20270101);
  const metricSelectors: Array<{ metric: Fig5Row['metric']; select: (record: ObservedTrajectoryRecord) => number }> = [
    { metric: 'PB', select: (record) => record.pb },
    { metric: 'CP', select: (record) => record.controlPreservation },
    { metric: 'Qctx', select: (record) => record.qCtx },
    { metric: 'Qtool', select: (record) => record.qTool },
    { metric: 'Qwf', select: (record) => record.qWf },
    { metric: 'Qeco', select: (record) => record.qEco },
  ];

  const rows: Fig5Row[] = [];
  for (const [system, scoped] of groupBySystem(records)) {
    for (const selector of metricSelectors) {
      const values = scoped.map(selector.select);
      const ci = bootstrapCI(values, replicates, 0.05, rng);
      rows.push({
        system,
        metric: selector.metric,
        mean: ci.mean,
        ciLow: ci.lo,
        ciHigh: ci.hi,
        sampleCount: values.length,
      });
    }
  }

  return generated('fig5-bootstrap-ci', 'Figure 5', rows);
}

// ---------------------------------------------------------------------------
// Figure 2a / 3 / 6 / 8
// ---------------------------------------------------------------------------

export interface Fig2aRow {
  defect: string;
  abbreviation: string;
  group: string;
  correlationWithFailure: number;
  triggerRate: number;
  failureRateWhenTriggered: number;
  failureRateWhenNotTriggered: number;
  support: number;
}

/** Figure 2a: association between defect triggers and endpoint failure */
export function buildFig2a(records: ObservedTrajectoryRecord[]): ArtifactOutcome<Fig2aRow> {
  const withOutcome = records.filter((record) => record.success !== null);
  if (withOutcome.length === 0) {
    return blocked(
      'fig2a-defect-failure-correlation',
      'Figure 2 (left)',
      'Defect-failure association needs endpoint outcomes, but success is null for every trajectory.'
    );
  }

  const failed = withOutcome.map((record) => record.success === false);
  const rows: Fig2aRow[] = [];

  for (const spec of PROCCTRL_TAXONOMY) {
    const triggered = withOutcome.map((record) => defectTriggered(record, spec.key));
    const association = defectFailureAssociation(triggered, failed);

    const triggeredIndices = triggered.map((value, index) => ({ value, index })).filter((entry) => entry.value);
    const notTriggeredIndices = triggered
      .map((value, index) => ({ value, index }))
      .filter((entry) => !entry.value);

    const failureRate = (indices: Array<{ index: number }>) =>
      indices.length === 0 ? 0 : indices.filter((entry) => failed[entry.index]).length / indices.length;

    rows.push({
      defect: spec.paperName,
      abbreviation: spec.abbreviation,
      group: DIMENSION_LABELS[spec.dimension],
      correlationWithFailure: association.correlation,
      triggerRate: triggeredIndices.length / withOutcome.length,
      failureRateWhenTriggered: failureRate(triggeredIndices),
      failureRateWhenNotTriggered: failureRate(notTriggeredIndices),
      support: withOutcome.length,
    });
  }

  rows.sort((left, right) => right.correlationWithFailure - left.correlationWithFailure);
  return generated('fig2a-defect-failure-correlation', 'Figure 2 (left)', rows);
}

export interface Fig3Row {
  system: string;
  defect: string;
  abbreviation: string;
  group: string;
  /** Process quality score for this defect dimension: 1 - mean posterior risk */
  benchmarkScore: number;
  triggerRate: number;
  sampleCount: number;
}

/** Figure 3: per-defect system profile heatmap data */
export function buildFig3(records: ObservedTrajectoryRecord[]): ArtifactOutcome<Fig3Row> {
  if (records.length === 0) {
    return blocked('fig4-per-defect-profiles', 'Figure 4', 'No trajectory records were supplied.');
  }

  const rows: Fig3Row[] = [];
  for (const [system, scoped] of groupBySystem(records)) {
    for (const spec of PROCCTRL_TAXONOMY) {
      const risks = scoped.map((record) => defectPosteriorRisk(record, spec.key));
      const meanRisk = risks.reduce((sum, value) => sum + value, 0) / risks.length;
      const triggeredCount = scoped.filter((record) => defectTriggered(record, spec.key)).length;

      rows.push({
        system,
        defect: spec.paperName,
        abbreviation: spec.abbreviation,
        group: DIMENSION_LABELS[spec.dimension],
        benchmarkScore: 1 - meanRisk,
        triggerRate: triggeredCount / scoped.length,
        sampleCount: scoped.length,
      });
    }
  }

  return generated('fig4-per-defect-profiles', 'Figure 4', rows);
}

export interface Fig6Row {
  rowDefect: string;
  columnDefect: string;
  correlation: number;
  support: number;
}

/** Figure 6: pairwise correlation matrix of defect posterior risks */
export function buildFig6(records: ObservedTrajectoryRecord[]): ArtifactOutcome<Fig6Row> {
  if (records.length < 2) {
    return blocked(
      'fig3-inter-defect-correlation',
      'Figure 3',
      `Pairwise correlation needs at least two trajectories, found ${records.length}.`
    );
  }

  const seriesByKey: Record<string, number[]> = {};
  for (const spec of PROCCTRL_TAXONOMY) {
    seriesByKey[spec.abbreviation] = records.map((record) => defectPosteriorRisk(record, spec.key));
  }

  const matrix = computeCorrelationMatrix(seriesByKey, 'spearman');
  const rows: Fig6Row[] = [];
  for (let rowIndex = 0; rowIndex < matrix.keys.length; rowIndex++) {
    for (let colIndex = 0; colIndex < matrix.keys.length; colIndex++) {
      rows.push({
        rowDefect: matrix.keys[rowIndex],
        columnDefect: matrix.keys[colIndex],
        correlation: matrix.matrix[rowIndex][colIndex],
        support: matrix.support,
      });
    }
  }

  return generated('fig3-inter-defect-correlation', 'Figure 3', rows);
}

export interface Fig8Row {
  eta: number;
  system: string;
  pb: number;
  rank: number;
}

/** Figure 8: PB sensitivity to eta */
export function buildFig8(
  records: ObservedTrajectoryRecord[],
  steps = 21
): ArtifactOutcome<Fig8Row> {
  if (records.length === 0) {
    return blocked('fig8-eta-sensitivity', 'Figure 8', 'No trajectory records were supplied.');
  }

  const systems: Array<{ system: string; qDef: number; cp: number }> = [];
  for (const [system, scoped] of groupBySystem(records)) {
    systems.push({
      system,
      qDef: scoped.reduce((sum, record) => sum + record.qDef, 0) / scoped.length,
      cp: scoped.reduce((sum, record) => sum + record.controlPreservation, 0) / scoped.length,
    });
  }

  const sweep = sweepEtaSensitivity(systems, steps);
  const rows: Fig8Row[] = [];
  for (const point of sweep) {
    for (const system of Object.keys(point.scoreBySystem)) {
      rows.push({
        eta: point.eta,
        system,
        pb: point.scoreBySystem[system],
        rank: point.rankBySystem[system],
      });
    }
  }

  return generated('fig8-eta-sensitivity', 'Figure 8', rows);
}

// ---------------------------------------------------------------------------
// Table 4: evaluation-point accounting
// ---------------------------------------------------------------------------

export interface Table4AccountingRow {
  benchmarkDimension: string;
  defectsPerTrajectory: number;
  totalOverTrajectories: number;
  /** Number of judgments actually present in the annotation set (checks full 11-class coverage) */
  annotatedJudgments: number;
  supportCases: number;
}

/**
 * Table 4: accounting for 200 trajectories x 11 defects = 2,200 judgments.
 * Rows are computed from the actual annotation set; if coverage is incomplete,
 * `annotatedJudgments` falls below the theoretical value and exposes the gap.
 */
export function buildTable4Accounting(
  annotationRows: FlatAnnotationRow[]
): ArtifactOutcome<Table4AccountingRow> {
  if (annotationRows.length === 0) {
    return blocked(
      'table4-evaluation-point-accounting',
      'Table 4',
      'Evaluation-point accounting requires the annotation set to know how many trajectories were labelled.'
    );
  }
  const caseIds = new Set(annotationRows.map((row) => row.caseId));
  const rows: Table4AccountingRow[] = [];
  for (const dimension of PROCCTRL_DIMENSION_KEYS) {
    const defects = defectsOfDimension(dimension);
    rows.push({
      benchmarkDimension: DIMENSION_LABELS[dimension],
      defectsPerTrajectory: defects.length,
      totalOverTrajectories: caseIds.size * defects.length,
      annotatedJudgments: annotationRows.filter((row) => defects.includes(row.defect)).length,
      supportCases: caseIds.size,
    });
  }
  return generated('table4-evaluation-point-accounting', 'Table 4', rows);
}

// ---------------------------------------------------------------------------
// Table 5：per-system / per-source distribution
// ---------------------------------------------------------------------------

export interface Table5DistributionRow {
  system: string;
  sweTotal: number;
  sweHeldOut: number | null;
  terminalTotal: number;
  terminalHeldOut: number | null;
  androidTotal: number;
  androidHeldOut: number | null;
  totalTrajectories: number;
  heldOutTrajectories: number | null;
  endpointSuccesses: number;
  heldOutSuccesses: number | null;
  adjudicatedPositiveDefects: number;
  heldOutPositiveDefects: number | null;
}

function countBenchmark(
  records: ObservedTrajectoryRecord[],
  benchmark: string,
  splitByCaseId: Record<string, PaperSplitName> | undefined,
  heldOut: boolean
): number | null {
  if (heldOut && !splitByCaseId) return null;
  return records.filter(
    (record) =>
      record.benchmark === benchmark &&
      (!heldOut || splitOfRecord(record, splitByCaseId) === 'evaluation')
  ).length;
}

/**
 * Table 5: per-system / per-source total and held-out samples, endpoint successes,
 * and adjudicated positive defects. Requires annotations; held-out columns require a split.
 */
export function buildTable5Distribution(
  records: ObservedTrajectoryRecord[],
  annotationRows: FlatAnnotationRow[],
  options?: SplitAwareOptions
): ArtifactOutcome<Table5DistributionRow> {
  if (records.length === 0 || annotationRows.length === 0) {
    return blocked(
      'table5-sample-distribution',
      'Table 5',
      'Table 5 needs both evaluated trajectories and the annotation set (for adjudicated positive defects).'
    );
  }

  const recordByKey = new Map<string, ObservedTrajectoryRecord>();
  for (const record of records) {
    recordByKey.set(caseKeyOfRecord(record), record);
    recordByKey.set(`${record.benchmark}/${record.taskId}/${record.trialId || 'single'}`, record);
  }

  const systems = [...groupBySystem(records).keys()].sort();
  const rows: Table5DistributionRow[] = [];
  for (const system of systems) {
    const scopedRecords = records.filter((record) => systemOf(record) === system);
    const scopedAnnotations = annotationRows.filter((row) => {
      const record = recordByKey.get(row.rawPath || '') ?? recordByKey.get(row.caseId);
      return record ? systemOf(record) === system : row.system === system;
    });
    const heldOutAnnotations = options?.splitByCaseId
      ? scopedAnnotations.filter(
          (row) => splitOfAnnotationRow(row, options.splitByCaseId) === 'evaluation'
        )
      : [];
    const positives = scopedAnnotations.filter((row) => row.label).length;
    const heldOutPositives = options?.splitByCaseId
      ? heldOutAnnotations.filter((row) => row.label).length
      : null;

    const sweTotal = countBenchmark(scopedRecords, 'swe-bench-verified', options?.splitByCaseId, false) ?? 0;
    const terminalTotal = countBenchmark(scopedRecords, 'terminal-bench', options?.splitByCaseId, false) ?? 0;
    const androidTotal = countBenchmark(scopedRecords, 'android-bench', options?.splitByCaseId, false) ?? 0;
    const heldOutRecords = options?.splitByCaseId
      ? scopedRecords.filter((record) => splitOfRecord(record, options.splitByCaseId) === 'evaluation')
      : [];

    rows.push({
      system,
      sweTotal,
      sweHeldOut: countBenchmark(scopedRecords, 'swe-bench-verified', options?.splitByCaseId, true),
      terminalTotal,
      terminalHeldOut: countBenchmark(scopedRecords, 'terminal-bench', options?.splitByCaseId, true),
      androidTotal,
      androidHeldOut: countBenchmark(scopedRecords, 'android-bench', options?.splitByCaseId, true),
      totalTrajectories: scopedRecords.length,
      heldOutTrajectories: options?.splitByCaseId ? heldOutRecords.length : null,
      endpointSuccesses: scopedRecords.filter((record) => record.success === true).length,
      heldOutSuccesses: options?.splitByCaseId
        ? heldOutRecords.filter((record) => record.success === true).length
        : null,
      adjudicatedPositiveDefects: positives,
      heldOutPositiveDefects: heldOutPositives,
    });
  }

  rows.sort((left, right) => right.totalTrajectories - left.totalTrajectories);
  const artifact = generated('table5-sample-distribution', 'Table 5', rows);
  if (!options?.splitByCaseId) {
    artifact.reason = 'No split assignment supplied; held-out columns are null.';
  }
  return artifact;
}

// ---------------------------------------------------------------------------
// Table 13：held-out defect detection and calibration
// ---------------------------------------------------------------------------

export interface Table13Row {
  defect: string;
  abbreviation: string;
  dimension: string;
  prevalence: number;
  effectiveN: number;
  f1: number;
  auroc: number;
  hardEce: number;
  bayesEce: number;
  hardBrier: number;
  bayesBrier: number;
  hardLogLoss: number;
  bayesLogLoss: number;
}

export interface Table13Options extends SplitAwareOptions {
  /** Development-split trajectories and annotations, used for the empirical hard-threshold mapping */
  devRecords?: ObservedTrajectoryRecord[];
  devAnnotationRows?: FlatAnnotationRow[];
}

function buildSamplesForDefect(
  records: ObservedTrajectoryRecord[],
  annotationRows: FlatAnnotationRow[],
  defect: ProcCtrlDefectKey
): Array<DetectionSample & { exempt: boolean }> {
  const recordByKey = new Map<string, ObservedTrajectoryRecord>();
  for (const record of records) {
    recordByKey.set(caseKeyOfRecord(record), record);
    recordByKey.set(`${record.benchmark}/${record.taskId}/${record.trialId || 'single'}`, record);
  }
  const samples: Array<DetectionSample & { exempt: boolean }> = [];
  for (const row of annotationRows) {
    if (row.defect !== defect) continue;
    const record = recordByKey.get(row.rawPath || '') ?? recordByKey.get(row.caseId);
    if (!record) continue;
    samples.push({
      label: row.label,
      score: defectPosteriorRisk(record, defect),
      triggered: defectTriggered(record, defect),
      exempt: row.exempt,
    });
  }
  return samples;
}

/**
 * Table 13: detection/calibration metrics on the 80 held-out trajectories only.
 * Hard-threshold probabilities use the development-split empirical p_pos / p_neg mapping.
 */
export function buildTable13(
  records: ObservedTrajectoryRecord[],
  annotationRows: FlatAnnotationRow[],
  options?: Table13Options
): ArtifactOutcome<Table13Row> {
  const effectiveOptions: Table13Options | undefined =
    options?.split || !options?.splitByCaseId
      ? options
      : { ...options, split: 'evaluation' };
  const evalRecords = filterRecordsBySplit(records, effectiveOptions);
  const evalRows = filterAnnotationRowsBySplit(annotationRows, effectiveOptions);
  if (evalRecords.length === 0 || evalRows.length === 0) {
    return blocked(
      'table13-heldout-detection-calibration',
      'Table 13',
      'Held-out detection/calibration needs trajectories and annotations in the evaluation split.'
    );
  }

  const rows: Table13Row[] = [];
  for (const spec of PROCCTRL_TAXONOMY) {
    const evalSamples = buildSamplesForDefect(evalRecords, evalRows, spec.key).filter(
      (sample) => !sample.exempt
    );
    if (evalSamples.length === 0) continue;

    const devSamples = buildSamplesForDefect(
      options?.devRecords ?? [],
      options?.devAnnotationRows ?? [],
      spec.key
    ).filter((sample) => !sample.exempt);
    const hardMapping =
      devSamples.length > 0 ? estimateHardThresholdMapping(devSamples) : undefined;
    const detection = computeDetectionMetrics(evalSamples);
    const calibration = compareCalibrationDetailed(
      evalSamples.map((sample) => ({
        label: sample.label,
        triggered: sample.triggered,
        posteriorRisk: sample.score,
      })),
      {
        binning: 'equal-mass',
        bucketCount: 10,
        hardMapping,
      }
    );

    rows.push({
      defect: spec.paperName,
      abbreviation: spec.abbreviation,
      dimension: DIMENSION_LABELS[spec.dimension],
      prevalence: detection.support === 0 ? 0 : detection.positives / detection.support,
      effectiveN: detection.support,
      f1: detection.f1,
      auroc: detection.auroc,
      hardEce: calibration.hardEce,
      bayesEce: calibration.bayesEce,
      hardBrier: calibration.hardBrier,
      bayesBrier: calibration.bayesBrier,
      hardLogLoss: calibration.hardLogLoss,
      bayesLogLoss: calibration.bayesLogLoss,
    });
  }

  if (rows.length > 0) {
    const average = (selector: (row: Table13Row) => number) =>
      rows.reduce((sum, row) => sum + selector(row), 0) / rows.length;
    rows.push({
      defect: 'Overall Mean',
      abbreviation: '-',
      dimension: '-',
      prevalence: average((row) => row.prevalence),
      effectiveN: rows.reduce((sum, row) => sum + row.effectiveN, 0),
      f1: average((row) => row.f1),
      auroc: average((row) => row.auroc),
      hardEce: average((row) => row.hardEce),
      bayesEce: average((row) => row.bayesEce),
      hardBrier: average((row) => row.hardBrier),
      bayesBrier: average((row) => row.bayesBrier),
      hardLogLoss: average((row) => row.hardLogLoss),
      bayesLogLoss: average((row) => row.bayesLogLoss),
    });
  }

  const artifact = generated('table13-heldout-detection-calibration', 'Table 13', rows);
  if (!options?.splitByCaseId) {
    artifact.reason = 'No split assignment supplied; figures use whatever records/annotations were passed.';
  }
  if (!options?.devRecords?.length || !options?.devAnnotationRows?.length) {
    artifact.reason = `${artifact.reason ? `${artifact.reason} ` : ''}No dev split supplied; hard-threshold ECE falls back to 0/1 predictions.`;
  }
  return artifact;
}

// ---------------------------------------------------------------------------
// Table 14：held-out cross-system comparison
// ---------------------------------------------------------------------------

export interface Table14Row {
  system: string;
  pb: number;
  qCtx: number;
  qTool: number;
  qWf: number;
  qEco: number;
  cp: number;
  fragileSuccessRate: number;
  sampleCount: number;
  observedOutcomeCount: number;
}

/** Table 14: recompute the cross-system scorecard on the held-out split only. */
export function buildTable14(
  records: ObservedTrajectoryRecord[],
  options?: ScorecardOptions & SplitAwareOptions
): ArtifactOutcome<Table14Row> {
  const effectiveOptions: (ScorecardOptions & SplitAwareOptions) | undefined =
    options?.split || !options?.splitByCaseId
      ? options
      : { ...options, split: 'evaluation' };
  const heldOut = filterRecordsBySplit(records, effectiveOptions);
  if (heldOut.length === 0) {
    return blocked(
      'table14-heldout-cross-system',
      'Table 14',
      'Held-out cross-system comparison needs trajectories in the evaluation split.'
    );
  }

  const rows: Table14Row[] = [];
  for (const [system, scoped] of groupBySystem(heldOut)) {
    const aggregated = aggregateSystemScorecard(system, scoped.map(recordToScorecardInput), options);
    rows.push({
      system,
      pb: aggregated.pb,
      qCtx: aggregated.qCtx,
      qTool: aggregated.qTool,
      qWf: aggregated.qWf,
      qEco: aggregated.qEco,
      cp: aggregated.cp,
      fragileSuccessRate: aggregated.fragileSuccessRate,
      sampleCount: aggregated.sampleCount,
      observedOutcomeCount: aggregated.observedOutcomeCount,
    });
  }
  rows.sort((left, right) => right.pb - left.pb);
  const artifact = generated('table14-heldout-cross-system', 'Table 14', rows);
  if (!options?.splitByCaseId) {
    artifact.reason = 'No split assignment supplied; Table 14 is computed over all supplied records.';
  }
  return artifact;
}

// ---------------------------------------------------------------------------
// Table 15：policy/infra deconfounding
// ---------------------------------------------------------------------------

export interface Table15Row {
  system: string;
  taskMatchedPassRate: number | null;
  heldOutPB: number;
  qPolicy: number;
  qInfra: number;
  commonEnvPB: number | null;
  sampleCount: number;
  matchedTaskCount: number;
}

/**
 * Table 15: deconfound agent policy from infrastructure properties.
 * Qpolicy / Qinfra are computed directly from records; task-matched pass rate uses only
 * tasks covered by every system; commonEnvPB requires records with commonEnvironment=true.
 */
export function buildTable15(
  records: ObservedTrajectoryRecord[],
  options?: ScorecardOptions & SplitAwareOptions
): ArtifactOutcome<Table15Row> {
  const scopedRecords = filterRecordsBySplit(records, options);
  if (scopedRecords.length === 0) {
    return blocked('table15-policy-infra', 'Table 15', 'No trajectory records were supplied.');
  }

  const systems = [...groupBySystem(scopedRecords).keys()];
  const tasksBySystem = new Map<string, Set<string>>();
  for (const system of systems) {
    tasksBySystem.set(
      system,
      new Set(
        scopedRecords
          .filter((record) => systemOf(record) === system)
          .map((record) => `${record.benchmark}/${record.taskId}`)
      )
    );
  }
  const commonTasks =
    systems.length === 0
      ? new Set<string>()
      : systems
          .map((system) => tasksBySystem.get(system)!)
          .reduce((intersection, current) => {
            return new Set([...intersection].filter((task) => current.has(task)));
          });

  const rows: Table15Row[] = [];
  for (const [system, scoped] of groupBySystem(scopedRecords)) {
    const aggregated = aggregateSystemScorecard(system, scoped.map(recordToScorecardInput), options);
    const meanPolicy =
      scoped.reduce(
        (sum, record) => sum + computePolicyQuality(defectRisksOfRecord(record)),
        0
      ) / scoped.length;
    const meanInfra =
      scoped.reduce(
        (sum, record) => sum + computeInfraQuality(defectRisksOfRecord(record)),
        0
      ) / scoped.length;

    const matched = scoped.filter((record) =>
      commonTasks.has(`${record.benchmark}/${record.taskId}`)
    );
    const withOutcome = matched.filter((record) => record.success !== null);
    const taskMatchedPassRate =
      withOutcome.length === 0
        ? null
        : withOutcome.filter((record) => record.success === true).length / withOutcome.length;

    const commonEnv = scoped.filter((record) => record.commonEnvironment === true);
    const commonEnvPB =
      commonEnv.length === 0
        ? null
        : aggregateSystemScorecard(system, commonEnv.map(recordToScorecardInput), options).pb;

    rows.push({
      system,
      taskMatchedPassRate,
      heldOutPB: aggregated.pb,
      qPolicy: meanPolicy,
      qInfra: meanInfra,
      commonEnvPB,
      sampleCount: scoped.length,
      matchedTaskCount: commonTasks.size,
    });
  }
  rows.sort((left, right) => right.heldOutPB - left.heldOutPB);
  return generated('table15-policy-infra', 'Table 15', rows);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/** Common upper bound for all outputs, enabling aggregate iteration and file writes */
export type AnyArtifactOutcome = ArtifactOutcome<object>;

export interface PaperArtifactBundle {
  artifacts: AnyArtifactOutcome[];
  /** Number of trajectories and systems included in the calculation */
  recordCount: number;
  systemCount: number;
  annotationRowCount: number;
  benchmarks: string[];
}

/**
 * Paper v8 numbering aliases.
 *
 * The early implementation numbered outputs as "Table 1..7 / Fig 2a,3,5,6,8"; paper v8 differs.
 * Old function names are kept for compatibility while paper-aligned names are provided.
 */
export const buildTable8 = buildTable3;
export const buildTable6Outcome = buildTable4;
export const buildTable7Agreement = buildTable5;
export const buildTable10Bootstrap = buildTable6;
export const buildTable12Control = buildTable7;
export const buildFig3Correlation = buildFig6;
export const buildFig4Profiles = buildFig3;

export interface PaperArtifactOptions extends BootstrapOptions, Table13Options {}

/** Build all paper outputs at once */
export function buildAllPaperArtifacts(
  records: ObservedTrajectoryRecord[],
  annotationRows: FlatAnnotationRow[],
  options?: PaperArtifactOptions
): PaperArtifactBundle {
  const scopedRecords = filterRecordsBySplit(records, options);
  const scopedAnnotations = filterAnnotationRowsBySplit(annotationRows, options);
  const table1 = buildTable1(scopedRecords, scopedAnnotations);

  const artifacts = [
    table1.detection,
    table1.calibration,
    buildTable2(scopedRecords, options),
    buildTable4Accounting(scopedAnnotations),
    buildTable5Distribution(scopedRecords, scopedAnnotations, options),
    buildTable8(scopedRecords, options),
    buildTable6Outcome(scopedRecords, options),
    buildTable7Agreement(scopedAnnotations),
    buildTable10Bootstrap(scopedRecords, options),
    buildTable12Control(scopedRecords, options),
    buildTable13(records, annotationRows, options),
    buildTable14(records, options),
    buildTable15(records, options),
    buildFig2a(scopedRecords),
    buildFig3Correlation(scopedRecords),
    buildFig4Profiles(scopedRecords),
    buildFig5(scopedRecords, options),
    table1.reliability,
    buildFig8(scopedRecords),
  ] as AnyArtifactOutcome[];

  return {
    artifacts,
    recordCount: scopedRecords.length,
    systemCount: groupBySystem(scopedRecords).size,
    annotationRowCount: scopedAnnotations.length,
    benchmarks: [...new Set(scopedRecords.map((record) => record.benchmark))].sort(),
  };
}
