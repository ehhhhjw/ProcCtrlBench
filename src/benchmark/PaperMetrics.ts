import {
  CalibrationPoint,
  Rng,
  brierScore,
  expectedCalibrationError,
  mean,
  pearson,
  rank,
  reliabilityDiagram,
  sampleStdDev,
  spearman,
} from './Stats';
import { CalibrationBucket } from '../types/evaluation.types';

/**
 * Evaluation metrics required by the ProcCtrlBench paper artifacts.
 *
* Coverage:
 * - Table 1, left block: per-defect precision / recall / F1 / AP / AUROC
 * - Table 1, right block: dimension-level ECE (hard threshold vs calibrated posterior)
 * - Table 7: annotation agreement (raw agreement / Cohen's kappa / exemption rate / adjudication rate)
 * - Table 10: bootstrap ranking stability
 * - Figure 3: inter-defect correlation matrix
 * - Figure 7: reliability diagram (reuses Stats.reliabilityDiagram)
 *
 * This module performs statistical computation only; it does no I/O and embeds no paper numbers.
 */

/** Pairing of the detection output and the human annotation for a single sample */
export interface DetectionSample {
  /** Human annotation: whether the defect is genuinely present */
  label: boolean;
  /** The detector's continuous evidence score s_j or calibrated posterior risk p_j, used for AP / AUROC */
  score: number;
  /** Binary trigger result finding_j, used for precision / recall / F1 */
  triggered: boolean;
}

export interface DetectionMetrics {
  /** Total sample count */
  support: number;
  /** Number of positives (annotated as present) */
  positives: number;
  /** Trigger rate, corresponding to the Trigger column of Table 1 in the paper */
  triggerRate: number;
  precision: number;
  recall: number;
  f1: number;
  /** Average Precision */
  ap: number;
  auroc: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  trueNegatives: number;
}

/**
 * Compute per-defect detection metrics (Table 1, left block of the paper).
 *
 * precision / recall / F1 are based on the binary trigger, while AP and AUROC are based on the
 * continuous score, so the two can disagree about how strong a detector is -- which is exactly
 * why the paper retains the continuous score s_j.
 */
export function computeDetectionMetrics(samples: DetectionSample[]): DetectionMetrics {
  const support = samples.length;
  if (support === 0) {
    return {
      support: 0,
      positives: 0,
      triggerRate: 0,
      precision: 0,
      recall: 0,
      f1: 0,
      ap: 0,
      auroc: 0,
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 0,
      trueNegatives: 0,
    };
  }

  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const sample of samples) {
    if (sample.triggered && sample.label) tp++;
    else if (sample.triggered && !sample.label) fp++;
    else if (!sample.triggered && sample.label) fn++;
    else tn++;
  }

  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  const labels = samples.map((sample) => sample.label);
  const scores = samples.map((sample) => sample.score);

  return {
    support,
    positives: tp + fn,
    triggerRate: (tp + fp) / support,
    precision,
    recall,
    f1,
    ap: averagePrecision(labels, scores),
    auroc: auroc(labels, scores),
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    trueNegatives: tn,
  };
}

/**
 * Average Precision: walk the samples in descending score order and, for each positive,
 * accumulate the precision at that position. No interpolation is applied, which is equivalent to
 * the stepwise area under the PR curve.
 */
export function averagePrecision(labels: boolean[], scores: number[]): number {
  if (labels.length === 0 || labels.length !== scores.length) {
    return 0;
  }
  const positives = labels.filter(Boolean).length;
  if (positives === 0) {
    return 0;
  }

  const ordered = labels
    .map((label, index) => ({ label, score: scores[index] }))
    .sort((left, right) => right.score - left.score);

  let seenPositives = 0;
  let sum = 0;
  for (let index = 0; index < ordered.length; index++) {
    if (ordered[index].label) {
      seenPositives++;
      sum += seenPositives / (index + 1);
    }
  }

  return sum / positives;
}

/**
 * AUROC, computed via the rank form of Mann-Whitney U, with tied scores handled by average ranks.
 * It is undefined when only a single class is present; 0 is returned and the caller should judge
 * that case together with positives.
 */
export function auroc(labels: boolean[], scores: number[]): number {
  if (labels.length === 0 || labels.length !== scores.length) {
    return 0;
  }

  const positiveCount = labels.filter(Boolean).length;
  const negativeCount = labels.length - positiveCount;
  if (positiveCount === 0 || negativeCount === 0) {
    return 0;
  }

  const ranks = rank(scores);
  let positiveRankSum = 0;
  for (let index = 0; index < labels.length; index++) {
    if (labels[index]) {
      positiveRankSum += ranks[index];
    }
  }

  return (
    (positiveRankSum - (positiveCount * (positiveCount + 1)) / 2) / (positiveCount * negativeCount)
  );
}

/**
 * Cohen's kappa (two annotators, binary judgements).
 * Returns 1 when agreement is perfect and there is no variation (both annotators said no to all).
 */
export function cohensKappa(annotatorA: boolean[], annotatorB: boolean[]): number {
  const n = Math.min(annotatorA.length, annotatorB.length);
  if (n === 0) {
    return 0;
  }

  let bothYes = 0;
  let bothNo = 0;
  let aYesBNo = 0;
  let aNoBYes = 0;
  for (let index = 0; index < n; index++) {
    const a = annotatorA[index];
    const b = annotatorB[index];
    if (a && b) bothYes++;
    else if (!a && !b) bothNo++;
    else if (a && !b) aYesBNo++;
    else aNoBYes++;
  }

  const observed = (bothYes + bothNo) / n;
  const aYesRate = (bothYes + aYesBNo) / n;
  const bYesRate = (bothYes + aNoBYes) / n;
  const expected = aYesRate * bYesRate + (1 - aYesRate) * (1 - bYesRate);

  if (expected === 1) {
    return observed === 1 ? 1 : 0;
  }
  return (observed - expected) / (1 - expected);
}

/** A single annotation record: both annotators' judgements plus exemption / adjudication flags */
export interface AnnotationPair {
  annotatorA: boolean;
  annotatorB: boolean;
  /** Whether the case was judged exempt given the task context */
  exempt?: boolean;
  /** Whether disagreement sent the case to third-party adjudication */
  adjudicated?: boolean;
}

export interface AgreementStats {
  support: number;
  rawAgreement: number;
  cohensKappa: number;
  exemptionRate: number;
  adjudicationRate: number;
}

/** Compute annotation agreement statistics (Table 7 of the paper). Agreement is computed before adjudication. */
export function computeAgreementStats(pairs: AnnotationPair[]): AgreementStats {
  const support = pairs.length;
  if (support === 0) {
    return { support: 0, rawAgreement: 0, cohensKappa: 0, exemptionRate: 0, adjudicationRate: 0 };
  }

  const agreed = pairs.filter((pair) => pair.annotatorA === pair.annotatorB).length;

  return {
    support,
    rawAgreement: agreed / support,
    cohensKappa: cohensKappa(
      pairs.map((pair) => pair.annotatorA),
      pairs.map((pair) => pair.annotatorB)
    ),
    exemptionRate: pairs.filter((pair) => pair.exempt === true).length / support,
    adjudicationRate: pairs.filter((pair) => pair.adjudicated === true).length / support,
  };
}

export interface CalibrationComparison {
  /** ECE under the direct hard-threshold interpretation */
  hardEce: number;
  /** ECE of the calibrated posterior risk */
  bayesEce: number;
  /** hard - bayes; a positive value means calibration improved things */
  improvement: number;
  hardBuckets: CalibrationBucket[];
  bayesBuckets: CalibrationBucket[];
  support: number;
}

/**
 * Compare the ECE of the hard threshold against the calibrated posterior
 * (Table 1, right block + Figure 7 of the paper).
 *
 * The hard branch treats the binary trigger result as the predicted probability (0 or 1), which is
 * precisely the semantics of "direct thresholding": once triggered, the defect is taken as
 * certainly present. The bayes branch uses the calibrated posterior risk.
 */
export function compareCalibration(
  samples: Array<{ label: boolean; triggered: boolean; posteriorRisk: number }>,
  bucketCount = 10
): CalibrationComparison {
  const hardPoints: CalibrationPoint[] = samples.map((sample) => ({
    predicted: sample.triggered ? 1 : 0,
    observed: sample.label ? 1 : 0,
  }));
  const bayesPoints: CalibrationPoint[] = samples.map((sample) => ({
    predicted: sample.posteriorRisk,
    observed: sample.label ? 1 : 0,
  }));

  const hardEce = expectedCalibrationError(hardPoints, bucketCount);
  const bayesEce = expectedCalibrationError(bayesPoints, bucketCount);

  return {
    hardEce,
    bayesEce,
    improvement: hardEce - bayesEce,
    hardBuckets: reliabilityDiagram(hardPoints, bucketCount),
    bayesBuckets: reliabilityDiagram(bayesPoints, bucketCount),
    support: samples.length,
  };
}

/**
 * Paper v8 Appendix B.3: ECE uses M = 10 equal-mass (quantile) bins rather than
 * equal-width bins, avoiding empty buckets for low-prevalence defects.
 */
export type CalibrationBinning = 'equal-width' | 'equal-mass';

export function logLoss(points: CalibrationPoint[]): number {
  if (points.length === 0) return 0;
  return (
    points.reduce((sum, point) => {
      const p = Math.min(1 - 1e-12, Math.max(1e-12, point.predicted));
      return sum - (point.observed === 1 ? Math.log(p) : Math.log(1 - p));
    }, 0) / points.length
  );
}

export function equalMassReliabilityDiagram(
  points: CalibrationPoint[],
  bucketCount = 10
): CalibrationBucket[] {
  if (points.length === 0) return [];
  const safeBucketCount = Math.max(1, Math.min(bucketCount, points.length));
  const ordered = [...points].sort((left, right) => left.predicted - right.predicted);
  const buckets: CalibrationBucket[] = [];

  for (let index = 0; index < safeBucketCount; index++) {
    const start = Math.floor((index * ordered.length) / safeBucketCount);
    const end = Math.floor(((index + 1) * ordered.length) / safeBucketCount);
    const scoped = ordered.slice(start, end);
    const observedCount = scoped.filter((point) => point.observed === 1).length;
    const meanPredictedRisk = scoped.length === 0 ? 0 : mean(scoped.map((point) => point.predicted));
    const observedRate = scoped.length === 0 ? 0 : observedCount / scoped.length;
    buckets.push({
      index,
      lowerBound: scoped.length === 0 ? 0 : scoped[0].predicted,
      upperBound: scoped.length === 0 ? 0 : scoped[scoped.length - 1].predicted,
      sampleCount: scoped.length,
      meanPredictedRisk,
      observedRate,
      absoluteGap: Math.abs(meanPredictedRisk - observedRate),
    });
  }
  return buckets;
}

export function expectedCalibrationErrorEqualMass(
  points: CalibrationPoint[],
  bucketCount = 10
): number {
  if (points.length === 0) return 0;
  const buckets = equalMassReliabilityDiagram(points, bucketCount);
  return buckets.reduce(
    (sum, bucket) => sum + (bucket.sampleCount / points.length) * bucket.absoluteGap,
    0
  );
}

export interface HardThresholdMapping {
  /** Paper B.3 p_pos = Pr(y=1 | s >= tau), estimated on the dev split */
  positiveProbability: number;
  /** Paper B.3 p_neg = Pr(y=1 | s < tau), estimated on the dev split */
  negativeProbability: number;
  support: number;
}

/**
 * Paper B.3: map hard triggers to the empirical precision / false-omission rate
 * estimated on the dev split, with Laplace smoothing epsilon = 1e-3.
 */
export function estimateHardThresholdMapping(
  samples: Array<{ label: boolean; triggered: boolean }>
): HardThresholdMapping {
  const epsilon = 1e-3;
  const positive = samples.filter((sample) => sample.triggered);
  const negative = samples.filter((sample) => !sample.triggered);
  const positiveHits = positive.filter((sample) => sample.label).length;
  const negativeHits = negative.filter((sample) => sample.label).length;
  return {
    positiveProbability: (positiveHits + epsilon) / (positive.length + 2 * epsilon),
    negativeProbability: (negativeHits + epsilon) / (negative.length + 2 * epsilon),
    support: samples.length,
  };
}

export interface DetailedCalibrationComparison extends CalibrationComparison {
  hardBrier: number;
  bayesBrier: number;
  hardLogLoss: number;
  bayesLogLoss: number;
  hardMapping?: HardThresholdMapping;
}

/**
 * Paper-aligned calibration comparison: equal-mass ECE + dev empirical
 * hard-threshold mapping + Brier / Log-Loss.
 */
export function compareCalibrationDetailed(
  samples: Array<{ label: boolean; triggered: boolean; posteriorRisk: number }>,
  options: {
    bucketCount?: number;
    binning?: CalibrationBinning;
    hardMapping?: HardThresholdMapping;
  } = {}
): DetailedCalibrationComparison {
  const bucketCount = options.bucketCount ?? 10;
  const binning = options.binning ?? 'equal-mass';
  const hardMapping = options.hardMapping;

  const hardPoints: CalibrationPoint[] = samples.map((sample) => ({
    predicted: sample.triggered
      ? hardMapping?.positiveProbability ?? 1
      : hardMapping?.negativeProbability ?? 0,
    observed: sample.label ? 1 : 0,
  }));
  const bayesPoints: CalibrationPoint[] = samples.map((sample) => ({
    predicted: sample.posteriorRisk,
    observed: sample.label ? 1 : 0,
  }));

  const computeEce = (points: CalibrationPoint[]) =>
    binning === 'equal-mass'
      ? expectedCalibrationErrorEqualMass(points, bucketCount)
      : expectedCalibrationError(points, bucketCount);
  const diagram = (points: CalibrationPoint[]) =>
    binning === 'equal-mass'
      ? equalMassReliabilityDiagram(points, bucketCount)
      : reliabilityDiagram(points, bucketCount);

  const hardEce = computeEce(hardPoints);
  const bayesEce = computeEce(bayesPoints);

  return {
    hardEce,
    bayesEce,
    improvement: hardEce - bayesEce,
    hardBuckets: diagram(hardPoints),
    bayesBuckets: diagram(bayesPoints),
    support: samples.length,
    hardBrier: brierScore(hardPoints),
    bayesBrier: brierScore(bayesPoints),
    hardLogLoss: logLoss(hardPoints),
    bayesLogLoss: logLoss(bayesPoints),
    hardMapping,
  };
}

/** One system's score series across a set of samples, used for bootstrap ranking */
export interface RankStabilityInput {
  system: string;
  /** Per-sample scores (usually the per-trajectory PB) */
  scores: number[];
  /**
   * Stratum labels of the same length as scores and aligned in order (usually the benchmark source).
   * Treated as a single stratum when omitted.
   */
  strata?: string[];
  /**
   * 与 scores 等长且顺序对齐的 task key（benchmark/taskId）。
   * 若所有系统共享同一组 taskKeys，bootstrap 会做 task-grouped paired
   * 重采样（论文口径）；否则退化为各系统独立分层重采样。
   */
  taskKeys?: string[];
}

export interface RankStabilityRow {
  system: string;
  meanRank: number;
  rankStdDev: number;
  top1Frequency: number;
  top3Frequency: number;
  /** Mean of the per-replicate mean scores */
  meanScore: number;
}

export interface RankStabilityOptions {
  replicates?: number;
  rng?: Rng;
  /** When ranking, higher scores are better */
  higherIsBetter?: boolean;
}

function groupIndicesByStratum(strata: string[] | undefined, length: number): number[][] {
  if (!strata || strata.length !== length) {
    return [Array.from({ length }, (_, index) => index)];
  }
  const groups = new Map<string, number[]>();
  for (let index = 0; index < length; index++) {
    const key = strata[index];
    const bucket = groups.get(key);
    if (bucket) bucket.push(index);
    else groups.set(key, [index]);
  }
  return [...groups.values()];
}

/**
* Stratified bootstrap ranking stability (Table 10 of the paper).
 *
 * Each replicate resamples with replacement within each system's own strata, recomputes that
 * system's mean score, ranks all systems, and accumulates mean rank / rank std / Top-1 / Top-3
 * frequencies.
 *
 * Note: this is implemented as "each system resamples within its own sample set", so the systems
 * are not required to run on exactly the same task subset. When their task sets do coincide, this
 * implementation agrees with paired resampling in expectation.
 */
export function bootstrapRankStability(
  inputs: RankStabilityInput[],
  options?: RankStabilityOptions
): RankStabilityRow[] {
  const replicates = Math.max(1, options?.replicates ?? 2000);
  const rng = options?.rng ?? Math.random;
  const higherIsBetter = options?.higherIsBetter !== false;

  const usable = inputs.filter((input) => input.scores.length > 0);
  if (usable.length === 0) {
    return inputs.map((input) => ({
      system: input.system,
      meanRank: 0,
      rankStdDev: 0,
      top1Frequency: 0,
      top3Frequency: 0,
      meanScore: 0,
    }));
  }

  const pairedTaskKeys =
    usable.every(
      (input) =>
        input.taskKeys &&
        input.taskKeys.length === input.scores.length &&
        input.taskKeys.join('') === usable[0].taskKeys!.join('')
    )
      ? usable[0].taskKeys!
      : undefined;

  const strataIndices = usable.map((input) =>
    groupIndicesByStratum(input.strata, input.scores.length)
  );

  const rankSamples = new Map<string, number[]>();
  const scoreSamples = new Map<string, number[]>();
  for (const input of usable) {
    rankSamples.set(input.system, []);
    scoreSamples.set(input.system, []);
  }

  for (let replicate = 0; replicate < replicates; replicate++) {
    const pairedIndices = pairedTaskKeys
      ? pairedTaskKeys.map(() => Math.floor(rng() * pairedTaskKeys.length))
      : undefined;
    const replicateScores = pairedTaskKeys
      ? usable.map((input) => {
          // task-grouped paired resampling: 同一组 task 索引同时作用于所有系统
          const resampled = pairedIndices!.map((index) => input.scores[index]);
          return { system: input.system, score: mean(resampled) };
        })
      : usable.map((input, systemIndex) => {
          const resampled: number[] = [];
          for (const stratum of strataIndices[systemIndex]) {
            for (let pick = 0; pick < stratum.length; pick++) {
              const chosen = stratum[Math.floor(rng() * stratum.length)];
              resampled.push(input.scores[chosen]);
            }
          }
          return { system: input.system, score: mean(resampled) };
        });

    const ordered = [...replicateScores].sort((left, right) =>
      higherIsBetter ? right.score - left.score : left.score - right.score
    );
    ordered.forEach((entry, position) => {
      rankSamples.get(entry.system)!.push(position + 1);
      scoreSamples.get(entry.system)!.push(entry.score);
    });
  }

  return usable.map((input) => {
    const ranks = rankSamples.get(input.system)!;
    return {
      system: input.system,
      meanRank: mean(ranks),
      rankStdDev: sampleStdDev(ranks),
      top1Frequency: ranks.filter((value) => value === 1).length / ranks.length,
      top3Frequency: ranks.filter((value) => value <= 3).length / ranks.length,
      meanScore: mean(scoreSamples.get(input.system)!),
    };
  });
}

export interface CorrelationMatrix {
  /** Row/column order */
  keys: string[];
  /** matrix[i][j] is the correlation coefficient between keys[i] and keys[j] */
  matrix: number[][];
  /** Sample count that entered the computation */
  support: number;
  method: 'spearman' | 'pearson';
}

/**
* Inter-defect correlation matrix (Figure 3 of the paper).
 *
 * The input maps each key to a per-trajectory series; all series must be of equal length and
 * aligned in the same trajectory order. The paper uses this to check whether the defects collapse
 * into a single latent signal, so Spearman is the default (posterior risk distributions are
 * usually skewed, and rank correlation is more robust).
 */
export function computeCorrelationMatrix(
  seriesByKey: Record<string, number[]>,
  method: 'spearman' | 'pearson' = 'spearman'
): CorrelationMatrix {
  const keys = Object.keys(seriesByKey);
  const lengths = new Set(keys.map((key) => seriesByKey[key].length));
  if (keys.length === 0) {
    return { keys: [], matrix: [], support: 0, method };
  }
  if (lengths.size > 1) {
    throw new Error(
      `computeCorrelationMatrix requires equal-length aligned series, got lengths: ${[...lengths].join(', ')}`
    );
  }

  const support = seriesByKey[keys[0]].length;
  const correlate = method === 'spearman' ? spearman : pearson;

  const matrix = keys.map((rowKey) =>
    keys.map((colKey) =>
      rowKey === colKey ? 1 : correlate(seriesByKey[rowKey], seriesByKey[colKey])
    )
  );

  return { keys, matrix, support, method };
}

/**
 * Association strength between defect triggering and endpoint failure (Figure 2, left, of the paper).
 * Returns the point-biserial correlation (equivalent to Pearson over 0/1 encodings).
 */
export function defectFailureAssociation(
  triggered: boolean[],
  failed: boolean[]
): { correlation: number; support: number } {
  const n = Math.min(triggered.length, failed.length);
  if (n === 0) {
    return { correlation: 0, support: 0 };
  }
  const xs = triggered.slice(0, n).map((value) => (value ? 1 : 0));
  const ys = failed.slice(0, n).map((value) => (value ? 1 : 0));
  return { correlation: spearman(xs, ys), support: n };
}
