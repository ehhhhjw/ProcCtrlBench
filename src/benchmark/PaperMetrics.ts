import {
  CalibrationPoint,
  Rng,
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
 * ProcCtrlBench 论文产出所需的评测指标。
 *
 * 覆盖：
 * - Table 1 左块：逐缺陷 precision / recall / F1 / AP / AUROC
 * - Table 1 右块：维度级 ECE（hard 阈值 vs 校准后验）
 * - Table 5：标注一致性（raw agreement / Cohen's kappa / 豁免率 / 仲裁率）
 * - Table 6：bootstrap 排名稳定性
 * - Figure 6：缺陷间相关矩阵
 * - Figure 7：reliability diagram（复用 Stats.reliabilityDiagram）
 *
 * 本模块只做统计计算，不涉及 I/O，也不内置任何论文数值。
 */

/** 单个样本的检测输出与人工标注的配对 */
export interface DetectionSample {
  /** 人工标注：该缺陷是否真实存在 */
  label: boolean;
  /** 检测器连续证据分 s_j 或校准后验风险 p_j，用于 AP / AUROC */
  score: number;
  /** 二值触发结果 finding_j，用于 precision / recall / F1 */
  triggered: boolean;
}

export interface DetectionMetrics {
  /** 样本总数 */
  support: number;
  /** 正例（标注为存在）数量 */
  positives: number;
  /** 触发率，对应论文 Table 1 的 Trigger 列 */
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
 * 计算逐缺陷检测指标（论文 Table 1 左块）。
 *
 * precision / recall / F1 基于二值触发；AP 与 AUROC 基于连续分，
 * 因此二者可能给出不同的强弱判断——这正是论文保留连续分 s_j 的原因。
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
 * Average Precision：按分数降序遍历，对每个正例累加其位置上的精确率。
 * 未做插值，等价于 PR 曲线的阶梯面积。
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
 * AUROC，用 Mann-Whitney U 的秩形式计算，并列分数由平均秩处理。
 * 当只有单一类别时无定义，返回 0 并由调用方结合 positives 判断。
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
 * Cohen's kappa（两名标注者，二值判断）。
 * 完全一致且无变异时（两人都判全否）返回 1。
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

/** 单条标注记录：两名标注者判断 + 豁免 / 仲裁标记 */
export interface AnnotationPair {
  annotatorA: boolean;
  annotatorB: boolean;
  /** 是否在任务语境下被判定为豁免 */
  exempt?: boolean;
  /** 是否因分歧进入第三方仲裁 */
  adjudicated?: boolean;
}

export interface AgreementStats {
  support: number;
  rawAgreement: number;
  cohensKappa: number;
  exemptionRate: number;
  adjudicationRate: number;
}

/** 计算标注一致性统计（论文 Table 5）。一致性在仲裁前计算。 */
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
  /** 直接硬阈值解释的 ECE */
  hardEce: number;
  /** 校准后验风险的 ECE */
  bayesEce: number;
  /** hard - bayes，正值表示校准带来改善 */
  improvement: number;
  hardBuckets: CalibrationBucket[];
  bayesBuckets: CalibrationBucket[];
  support: number;
}

/**
 * 对比硬阈值与校准后验的 ECE（论文 Table 1 右块 + Figure 7）。
 *
 * hard 分支把二值触发结果当作预测概率（0 或 1），这正是"直接阈值化"的
 * 语义：一旦触发即视为确定存在。bayes 分支使用校准后的后验风险。
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

/** 一个系统在若干样本上的分数序列，用于 bootstrap 排名 */
export interface RankStabilityInput {
  system: string;
  /** 逐样本分数（通常是逐轨迹 PB） */
  scores: number[];
  /**
   * 与 scores 等长且顺序对齐的分层标签（通常是 benchmark 来源）。
   * 缺省时视为单一层。
   */
  strata?: string[];
}

export interface RankStabilityRow {
  system: string;
  meanRank: number;
  rankStdDev: number;
  top1Frequency: number;
  top3Frequency: number;
  /** 各重采样轮次的平均分的均值 */
  meanScore: number;
}

export interface RankStabilityOptions {
  replicates?: number;
  rng?: Rng;
  /** 排名时分数越高越好 */
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
 * 分层 bootstrap 排名稳定性（论文 Table 6）。
 *
 * 每轮在每个系统各自的分层内做有放回重采样，重算该系统均分后对全部系统排名，
 * 统计 mean rank / rank std / Top-1 / Top-3 频率。
 *
 * 说明：这里按"每个系统在自己的样本集内重采样"实现，因此不要求各系统跑在
 * 完全相同的任务子集上。若各系统任务集一致，该实现与配对重采样在期望上一致。
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
    const replicateScores = usable.map((input, systemIndex) => {
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
  /** 行/列顺序 */
  keys: string[];
  /** matrix[i][j] 为 keys[i] 与 keys[j] 的相关系数 */
  matrix: number[][];
  /** 参与计算的样本数 */
  support: number;
  method: 'spearman' | 'pearson';
}

/**
 * 缺陷间相关矩阵（论文 Figure 6）。
 *
 * 输入为 key -> 逐轨迹序列，各序列需等长且按同一轨迹顺序对齐。
 * 论文用于检验各缺陷是否塌缩为单一潜在信号，因此默认使用 Spearman
 * （后验风险的分布通常偏斜，秩相关更稳健）。
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
 * 缺陷触发与端点失败的关联强度（论文 Figure 2 左）。
 * 返回点二列相关（等价于以 0/1 编码的 Pearson）。
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
