import {
  DetectionIssue,
  DetectorDecisionStep,
  DetectorEvidenceDetails,
  DetectorExemption,
  DetectorThresholdSummary,
  EvaluationConfig,
  Severity,
} from '../types/evaluation.types';

const METRIC_ALIASES: Record<string, string> = {
  contextThrashing: 'thrashing',
};

export function canonicalizeDetectorMetric(metric: string): string {
  return METRIC_ALIASES[metric] || metric;
}

export function finalizeDetectorIssues(
  issues: DetectionIssue[],
  config: EvaluationConfig
): DetectionIssue[] {
  return issues.map((issue) => finalizeDetectorIssue(issue, config));
}

export function finalizeDetectorIssue(
  issue: DetectionIssue,
  config: EvaluationConfig
): DetectionIssue {
  const metric = canonicalizeDetectorMetric(issue.metric);
  const details = issue.evidence?.details || {};
  const baselineRisk = config.riskModel.metricPriors[metric] ?? 0.3;
  const baselineScore = config.detectorCalibration.baselineScores[metric] ?? 0.25;
  const rawSignal = extractRawSignal(metric, details, issue);
  const normalizedSignal = clamp(extractNormalizedSignal(metric, rawSignal, details, config));
  const evidenceWeight = resolveEvidenceWeight(issue.evidence?.type);
  const severityAnchor = config.riskModel.severityAnchors[issue.severity] ?? 0.5;
  const detectorScore = clamp(
    baselineScore * 0.45 +
      normalizedSignal * 0.4 +
      evidenceWeight * 0.08 +
      severityAnchor * 0.07
  );
  const normalizedExemptions = normalizeExemptions(issue, details);
  const exemptionsApplied = Array.from(
    new Set(
      [
        ...(Array.isArray(issue.exemptionsApplied) ? issue.exemptionsApplied : []),
        ...normalizedExemptions.filter((entry) => entry.matched).map((entry) => entry.code),
      ].filter((value): value is string => typeof value === 'string' && value.length > 0)
    )
  );
  const standardizedDetails = buildStandardEvidenceDetails(
    details,
    metric,
    config,
    rawSignal,
    normalizedSignal,
    detectorScore,
    baselineRisk,
    baselineScore,
    normalizedExemptions
  );

  return {
    ...issue,
    baselineRisk,
    baselineScore,
    rawSignal,
    normalizedSignal,
    detectorScore,
    exemptionsApplied,
    evidence: issue.evidence
      ? {
          ...issue.evidence,
          details: standardizedDetails,
        }
      : issue.evidence,
  };
}

function buildStandardEvidenceDetails(
  details: Record<string, any>,
  metric: string,
  config: EvaluationConfig,
  rawSignal: number,
  normalizedSignal: number,
  detectorScore: number,
  baselineRisk: number,
  baselineScore: number,
  normalizedExemptions: DetectorExemption[]
): DetectorEvidenceDetails {
  return {
    ...details,
    schemaVersion: 'detector-evidence/v1',
    canonicalMetric: metric,
    signalType: resolveSignalType(metric),
    signalSource: resolveSignalSource(metric),
    thresholds: buildThresholdSummary(metric, config),
    candidateCount: inferCandidateCount(metric, details),
    decisionPath: buildDecisionPath(rawSignal, normalizedSignal, detectorScore, details),
    baselineRisk,
    baselineScore,
    rawSignal,
    normalizedSignal,
    detectorScore,
    nativeDetectorScore: detectorScore,
    exemptions: normalizedExemptions,
  };
}

function extractRawSignal(
  metric: string,
  details: Record<string, any>,
  issue: DetectionIssue
): number {
  switch (metric) {
    case 'ghostContext':
      return asNumber(details.wastedTokens, asNumber(details.tokenSize, 0));
    case 'oversizedRules': {
      const tokenSignal = normalizeByThreshold(
        asNumber(details.tokenSize, 0),
        2000,
        4000
      );
      const ratioSignal = normalizeByThreshold(
        parseRatio(details.ratio),
        0.2,
        0.35
      );
      return Math.max(tokenSignal, ratioSignal);
    }
    case 'thrashing':
      return Math.max(
        asNumber(details.payloadSize, 0) / Math.max(asNumber(details.windowCapacity, 1), 1),
        parseRatio(details.windowUsage),
        asNumber(details.compressionDelay, 0)
      );
    case 'toolCallChain':
      return asNumber(details.consecutiveCount, asNumber(details.cycleCount, 0));
    case 'deadStep':
      return asNumber(
        details.failedChecks,
        Object.values(details.checks || {}).filter(Boolean).length
      );
    case 'duplicateStep':
      return (
        asNumber(details.inputSimilarity, 0) * 0.55 +
        asNumber(details.resultSimilarity, 0) * 0.35 +
        (issue.severity === Severity.Error ? 0.1 : 0)
      );
    case 'wrapperWorkflow':
      return asNumber(details.wrapperRate, 0);
    case 'contextCoupling':
      return Math.max(
        asNumber(details.size, 0),
        asNumber(details.patternCount, 0),
        asNumber(details.count, 0)
      );
    case 'longChain':
      return asNumber(details.effectiveLength, asNumber(details.totalSteps, 0));
    case 'inconsistentToolInterface':
      return asNumber(details.interfaceRisk, asNumber(details.effectiveDispersion, 0));
    case 'weakTool':
      return 1 - asNumber(details.callRate, 1);
    default:
      return issue.deduction;
  }
}

function extractNormalizedSignal(
  metric: string,
  rawSignal: number,
  details: Record<string, any>,
  config: EvaluationConfig
): number {
  switch (metric) {
    case 'ghostContext':
      return normalizeByThreshold(
        rawSignal,
        config.thresholds.ghostContext.warningTokens,
        config.thresholds.ghostContext.errorTokens
      );
    case 'oversizedRules':
      return rawSignal;
    case 'thrashing': {
      const payloadPressure = asNumber(details.payloadSize, 0) / Math.max(asNumber(details.windowCapacity, 1), 1);
      const delay = normalizeByThreshold(
        asNumber(details.compressionDelay, 0),
        1,
        config.thresholds.thrashing.compressionLookAhead
      );
      return clamp(Math.max(payloadPressure, delay, parseRatio(details.windowUsage)));
    }
    case 'toolCallChain':
      if (details.cycleCount !== undefined) {
        return normalizeByThreshold(
          asNumber(details.cycleCount, 0),
          config.thresholds.toolChain.cyclicWarningCount,
          config.thresholds.toolChain.cyclicErrorCount
        );
      }
      return normalizeByThreshold(
        asNumber(details.consecutiveCount, rawSignal),
        config.thresholds.toolChain.repetitiveWarningCount,
        config.thresholds.toolChain.repetitiveErrorCount
      );
    case 'deadStep':
      return normalizeByThreshold(rawSignal, 3, 4);
    case 'duplicateStep':
      return clamp(rawSignal);
    case 'wrapperWorkflow':
      return normalizeByThreshold(rawSignal, 0.8, 0.95);
    case 'contextCoupling':
      return normalizeByThreshold(rawSignal, 2, 4);
    case 'longChain':
      if (details.effectiveLength !== undefined) {
        return normalizeByThreshold(
          asNumber(details.effectiveLength, rawSignal),
          config.thresholds.longChain.warningLength,
          config.thresholds.longChain.errorLength
        );
      }
      return normalizeByThreshold(
        asNumber(details.totalSteps, rawSignal),
        config.thresholds.longChain.simpleWarningLength,
        config.thresholds.longChain.simpleErrorLength
      );
    case 'inconsistentToolInterface':
      return normalizeByThreshold(rawSignal, 0.4, 0.7);
    case 'weakTool':
      return normalizeByThreshold(rawSignal, 0.7, 0.85);
    default:
      return clamp(rawSignal);
  }
}

function normalizeByThreshold(raw: number, warning: number, error: number): number {
  if (raw <= 0) {
    return 0;
  }
  if (raw < warning) {
    return clamp((raw / Math.max(warning, 1e-6)) * 0.55);
  }
  if (raw >= error) {
    const overflow = (raw - error) / Math.max(error - warning, 1e-6);
    return clamp(0.8 + overflow * 0.2);
  }
  return clamp(0.55 + ((raw - warning) / Math.max(error - warning, 1e-6)) * 0.25);
}

function resolveSignalType(metric: string): string {
  switch (metric) {
    case 'ghostContext':
    case 'oversizedRules':
    case 'thrashing':
      return 'context-pressure';
    case 'toolCallChain':
    case 'deadStep':
    case 'duplicateStep':
    case 'weakTool':
      return 'execution-efficiency';
    case 'wrapperWorkflow':
    case 'contextCoupling':
    case 'longChain':
      return 'workflow-structure';
    case 'inconsistentToolInterface':
      return 'tool-interface';
    default:
      return 'heuristic';
  }
}

function resolveSignalSource(metric: string): string {
  switch (metric) {
    case 'ghostContext':
    case 'oversizedRules':
    case 'thrashing':
      return 'message-context';
    case 'toolCallChain':
    case 'deadStep':
    case 'duplicateStep':
    case 'weakTool':
      return 'tool-trace';
    case 'wrapperWorkflow':
    case 'contextCoupling':
    case 'longChain':
      return 'workflow-topology';
    case 'inconsistentToolInterface':
      return 'tool-schema';
    default:
      return 'detector';
  }
}

function buildThresholdSummary(metric: string, config: EvaluationConfig): DetectorThresholdSummary {
  switch (metric) {
    case 'ghostContext':
      return {
        warning: config.thresholds.ghostContext.warningTokens,
        error: config.thresholds.ghostContext.errorTokens,
      };
    case 'oversizedRules':
      return {
        warningTokens: config.thresholds.oversizedRules.warningTokens,
        errorTokens: config.thresholds.oversizedRules.errorTokens,
        warningRatio: config.thresholds.oversizedRules.warningRatio,
        errorRatio: config.thresholds.oversizedRules.errorRatio,
      };
    case 'thrashing':
      return {
        windowThreshold: config.thresholds.thrashing.windowThreshold,
        compressionLookAhead: config.thresholds.thrashing.compressionLookAhead,
      };
    case 'toolCallChain':
      return {
        repetitiveWarning: config.thresholds.toolChain.repetitiveWarningCount,
        repetitiveError: config.thresholds.toolChain.repetitiveErrorCount,
        cyclicWarning: config.thresholds.toolChain.cyclicWarningCount,
        cyclicError: config.thresholds.toolChain.cyclicErrorCount,
      };
    case 'longChain':
      return {
        effectiveWarning: config.thresholds.longChain.warningLength,
        effectiveError: config.thresholds.longChain.errorLength,
        simpleWarning: config.thresholds.longChain.simpleWarningLength,
        simpleError: config.thresholds.longChain.simpleErrorLength,
      };
    case 'deadStep':
      return {
        warning: 3,
        error: 4,
      };
    case 'wrapperWorkflow':
      return {
        warning: 0.8,
        error: 0.95,
      };
    case 'contextCoupling':
      return {
        warning: 2,
        error: 4,
      };
    case 'inconsistentToolInterface':
      return {
        warning: 0.4,
        error: 0.7,
      };
    case 'weakTool':
      return {
        warning: 0.7,
        error: 0.85,
      };
    case 'duplicateStep':
      return {
        warning: 0.75,
        error: 0.92,
      };
    default:
      return {};
  }
}

function inferCandidateCount(metric: string, details: Record<string, any>): number | undefined {
  const values = [
    details.candidateCount,
    details.totalCalls,
    details.totalSteps,
    details.count,
    details.consecutiveCount,
    details.cycleCount,
    details.wrapperCalls,
    details.suitableTaskCount,
    details.patternCount,
    details.size,
  ];
  for (const value of values) {
    if (typeof value === 'number' && !Number.isNaN(value) && value > 0) {
      return value;
    }
  }

  if (metric === 'deadStep' && details.checks && typeof details.checks === 'object') {
    return Object.keys(details.checks).length;
  }

  return undefined;
}

function buildDecisionPath(
  rawSignal: number,
  normalizedSignal: number,
  detectorScore: number,
  details: Record<string, any>
): DetectorDecisionStep[] {
  return [
    {
      stage: 'signal',
      detail: 'raw signal extracted from detector-specific evidence',
      value: Number(rawSignal.toFixed(4)),
    },
    {
      stage: 'normalization',
      detail: 'raw signal normalized against metric thresholds',
      value: Number(normalizedSignal.toFixed(4)),
    },
    {
      stage: 'evidence',
      detail: `evidence type=${String(details.evidenceType || '') || 'detector-provided'}`,
    },
    {
      stage: 'severity',
      detail: 'detector severity anchor incorporated into calibrated score',
    },
    {
      stage: 'score',
      detail: 'native detector score emitted for downstream risk aggregation',
      value: Number(detectorScore.toFixed(4)),
    },
  ];
}

function normalizeExemptions(
  issue: DetectionIssue,
  details: Record<string, any>
): DetectorExemption[] {
  const rawValues = Array.isArray(details.exemptions) ? details.exemptions : [];
  const normalized = rawValues
    .map((entry): DetectorExemption | null => {
      if (typeof entry === 'string') {
        return {
          code: entry,
          reason: entry,
          matched: true,
          source: 'detector',
        };
      }
      if (entry && typeof entry === 'object') {
        const code = typeof entry.code === 'string'
          ? entry.code
          : typeof entry.reason === 'string'
            ? entry.reason
            : 'exemption';
        const reason = typeof entry.reason === 'string' ? entry.reason : code;
        return {
          code,
          reason,
          matched: entry.matched !== false,
          source: typeof entry.source === 'string' ? entry.source : 'detector',
        };
      }
      return null;
    })
    .filter((entry): entry is DetectorExemption => Boolean(entry));

  if (normalized.length > 0) {
    return normalized;
  }

  return (issue.exemptionsApplied || []).map((code) => ({
    code,
    reason: code,
    matched: true,
    source: 'issue',
  }));
}

function resolveEvidenceWeight(type?: 'weak' | 'medium' | 'strong'): number {
  if (type === 'strong') return 0.82;
  if (type === 'medium') return 0.6;
  if (type === 'weak') return 0.35;
  return 0.45;
}

function parseRatio(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (normalized.endsWith('%')) {
      return asNumber(Number(normalized.slice(0, -1)), 0) / 100;
    }
    return asNumber(Number(normalized), 0);
  }
  return 0;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && !Number.isNaN(value) ? value : fallback;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(Math.max(value, min), max);
}
