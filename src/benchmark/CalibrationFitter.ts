import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_EVALUATION_CONFIG } from '../config/evaluation.config';
import {
  CalibrationSummary,
  DetectorCalibrationProfile,
  EvaluationConfig,
  EvaluationReport,
  ProcessFinding,
  Severity,
} from '../types/evaluation.types';
import { brierScore, expectedCalibrationError, reliabilityDiagram } from './Stats';

export interface CalibrationFitOptions {
  labelMode?: 'severity-error' | 'risk-error';
  shrinkage?: number;
  bucketCount?: number;
  minMetricSamples?: number;
  profileName?: string;
  source?: string;
}

export interface MetricCalibrationFit {
  support: number;
  observedPositiveRate: number;
  meanDetectorScore: number;
  meanPosteriorRisk: number;
  meanNormalizedSignal: number;
}

export interface CalibrationFitResult {
  profile: DetectorCalibrationProfile;
  metrics: Record<string, MetricCalibrationFit>;
  globalCalibration: CalibrationSummary;
  totalFindings: number;
}

export function fitCalibrationProfile(
  reports: EvaluationReport[],
  baseConfig: EvaluationConfig = DEFAULT_EVALUATION_CONFIG,
  options: CalibrationFitOptions = {}
): CalibrationFitResult {
  const findings = reports.flatMap((report) => report.findings || []);
  const labelMode = options.labelMode || 'severity-error';
  const shrinkage = Math.max(options.shrinkage ?? 6, 0);
  const bucketCount = Math.max(options.bucketCount ?? baseConfig.riskModel.calibrationBucketCount ?? 10, 1);
  const minMetricSamples = Math.max(options.minMetricSamples ?? 2, 1);
  const metrics = Array.from(new Set(findings.map((finding) => finding.metric))).sort();
  const metricFits: Record<string, MetricCalibrationFit> = {};
  const metricPriors: Record<string, number> = {};
  const baselineScores: Record<string, number> = {};
  const metricSampleCounts: Record<string, number> = {};

  for (const metric of metrics) {
    const scoped = findings.filter((finding) => finding.metric === metric);
    metricSampleCounts[metric] = scoped.length;
    if (scoped.length < minMetricSamples) {
      continue;
    }

    const fit = summarizeMetric(scoped, labelMode);
    metricFits[metric] = fit;
    metricPriors[metric] = shrinkTowards(
      fit.observedPositiveRate,
      baseConfig.riskModel.metricPriors[metric] ?? 0.3,
      fit.support,
      shrinkage
    );
    baselineScores[metric] = shrinkTowards(
      fit.meanDetectorScore,
      baseConfig.detectorCalibration.baselineScores[metric] ?? 0.25,
      fit.support,
      shrinkage
    );
  }

  const severityAnchors = fitSeverityAnchors(findings, baseConfig, shrinkage);
  const evidenceWeights = fitEvidenceWeights(findings, baseConfig, shrinkage);
  const globalCalibration = summarizeGlobalCalibration(findings, labelMode, bucketCount);

  return {
    profile: {
      profileName: options.profileName || `learned-calibration-${labelMode}`,
      source: options.source || 'fitted-from-evaluation-reports',
      metadata: {
        totalFindings: findings.length,
        labelMode,
        shrinkage,
        generatedAt: new Date().toISOString(),
        calibration: globalCalibration,
        metricSampleCounts,
      },
      riskModel: {
        metricPriors,
        evidenceWeights,
        severityAnchors,
        calibrationBucketCount: bucketCount,
      },
      detectorCalibration: {
        baselineScores,
      },
    },
    metrics: metricFits,
    globalCalibration,
    totalFindings: findings.length,
  };
}

export function loadReportsFromDirectory(dir: string): EvaluationReport[] {
  const resolved = path.resolve(dir);
  const files = fs.readdirSync(resolved).filter((file) => file.startsWith('evaluation-') && file.endsWith('.json'));
  return files.map((file) =>
    JSON.parse(fs.readFileSync(path.join(resolved, file), 'utf-8')) as EvaluationReport
  );
}

function summarizeMetric(
  findings: ProcessFinding[],
  labelMode: 'severity-error' | 'risk-error'
): MetricCalibrationFit {
  const support = findings.length;
  const observedPositiveRate = support === 0
    ? 0
    : findings.filter((finding) => observationLabel(finding, labelMode) === 1).length / support;

  return {
    support,
    observedPositiveRate,
    meanDetectorScore: average(findings.map((finding) => finding.detectorScore)),
    meanPosteriorRisk: average(findings.map((finding) => finding.posteriorRisk)),
    meanNormalizedSignal: average(findings.map((finding) => finding.normalizedSignal)),
  };
}

function fitSeverityAnchors(
  findings: ProcessFinding[],
  baseConfig: EvaluationConfig,
  shrinkage: number
): Partial<Record<Severity, number>> {
  const entries: Severity[] = [
    Severity.Info,
    Severity.Warning,
    Severity.Error,
    Severity.Critical,
  ];
  const fitted: Partial<Record<Severity, number>> = {};
  for (const severity of entries) {
    const scoped = findings.filter((finding) => finding.severity === severity);
    if (scoped.length === 0) {
      continue;
    }
    fitted[severity] = shrinkTowards(
      average(scoped.map((finding) => finding.posteriorRisk)),
      baseConfig.riskModel.severityAnchors[severity],
      scoped.length,
      shrinkage
    );
  }
  return fitted;
}

function fitEvidenceWeights(
  findings: ProcessFinding[],
  baseConfig: EvaluationConfig,
  shrinkage: number
): Partial<Record<'weak' | 'medium' | 'strong', number>> {
  const entries: Array<'weak' | 'medium' | 'strong'> = ['weak', 'medium', 'strong'];
  const fitted: Partial<Record<'weak' | 'medium' | 'strong', number>> = {};
  for (const evidenceType of entries) {
    const scoped = findings.filter((finding) => finding.evidence?.type === evidenceType);
    if (scoped.length === 0) {
      continue;
    }
    fitted[evidenceType] = shrinkTowards(
      average(scoped.map((finding) => finding.posteriorRisk)),
      baseConfig.riskModel.evidenceWeights[evidenceType],
      scoped.length,
      shrinkage
    );
  }
  return fitted;
}

function summarizeGlobalCalibration(
  findings: ProcessFinding[],
  labelMode: 'severity-error' | 'risk-error',
  bucketCount: number
): CalibrationSummary {
  const points = findings.map((finding) => ({
    predicted: finding.posteriorRisk,
    observed: observationLabel(finding, labelMode),
  }));
  const buckets = reliabilityDiagram(points, bucketCount);
  const sampleCount = points.length;
  const observedPositiveRate = sampleCount === 0
    ? 0
    : points.filter((point) => point.observed === 1).length / sampleCount;

  return {
    bucketCount,
    sampleCount,
    labelDefinition: labelMode,
    meanPredictedRisk: average(points.map((point) => point.predicted)),
    observedPositiveRate,
    expectedCalibrationError: expectedCalibrationError(points, bucketCount),
    maxCalibrationGap: buckets.reduce((max, bucket) => Math.max(max, bucket.absoluteGap), 0),
    brierScore: brierScore(points),
    buckets,
  };
}

function observationLabel(
  finding: ProcessFinding,
  labelMode: 'severity-error' | 'risk-error'
): number {
  if (labelMode === 'risk-error') {
    return finding.riskSeverity === Severity.Error || finding.riskSeverity === Severity.Critical ? 1 : 0;
  }
  return finding.severity === Severity.Error || finding.severity === Severity.Critical ? 1 : 0;
}

function shrinkTowards(target: number, baseline: number, support: number, shrinkage: number): number {
  const weight = support / Math.max(support + shrinkage, 1);
  return clamp(baseline * (1 - weight) + target * weight);
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(Math.max(value, min), max);
}
