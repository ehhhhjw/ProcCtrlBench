import { CalibrationBucket } from '../types/evaluation.types';

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function variance(xs: number[]): number {
  if (xs.length <= 1) return 0;
  const m = mean(xs);
  const s = xs.reduce((a, b) => a + (b - m) * (b - m), 0);
  return s / (xs.length - 1);
}

/** 样本标准差（贝塞尔校正，n-1） */
export function sampleStdDev(xs: number[]): number {
  return Math.sqrt(variance(xs));
}

// Cohen's d for independent samples
export function cohensD(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const ma = mean(a), mb = mean(b);
  const va = variance(a), vb = variance(b);
  const na = a.length, nb = b.length;
  const sp = Math.sqrt(((na - 1) * va + (nb - 1) * vb) / (na + nb - 2 || 1));
  if (sp === 0) return 0;
  return (ma - mb) / sp;
}

/** 均匀分布随机数生成器，签名与 Math.random 一致 */
export type Rng = () => number;

/**
 * 可复现的随机数生成器（mulberry32）。
 *
 * 论文中的 bootstrap 结果需要可复现，因此凡涉及重采样的函数都应显式传入
 * 种子化 rng，而不是依赖全局 Math.random。
 */
export function createSeededRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function bootstrapCI(
  values: number[],
  B = 2000,
  alpha = 0.05,
  rng: Rng = Math.random
): { mean: number; lo: number; hi: number } {
  const n = values.length;
  const m = mean(values);
  if (n === 0) return { mean: 0, lo: 0, hi: 0 };
  const samples: number[] = [];
  for (let b = 0; b < B; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += values[Math.floor(rng() * n)];
    samples.push(s / n);
  }
  samples.sort((x, y) => x - y);
  const lo = samples[Math.floor(B * (alpha / 2))];
  const hi = samples[Math.floor(B * (1 - alpha / 2))];
  return { mean: m, lo, hi };
}

/** 秩变换，并列取平均秩 */
export function rank(values: number[]): number[] {
  const sorted = values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value);
  const ranks = new Array<number>(values.length);
  let cursor = 0;

  while (cursor < sorted.length) {
    let end = cursor + 1;
    while (end < sorted.length && sorted[end].value === sorted[cursor].value) {
      end++;
    }

    const avgRank = (cursor + end - 1) / 2 + 1;
    for (let index = cursor; index < end; index++) {
      ranks[sorted[index].index] = avgRank;
    }
    cursor = end;
  }

  return ranks;
}

export function pearson(xs: number[], ys: number[]): number {
  if (xs.length === 0 || ys.length === 0 || xs.length !== ys.length) {
    return 0;
  }

  const meanX = mean(xs);
  const meanY = mean(ys);
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;

  for (let index = 0; index < xs.length; index++) {
    const dx = xs[index] - meanX;
    const dy = ys[index] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  if (denomX === 0 || denomY === 0) {
    return 0;
  }

  return numerator / Math.sqrt(denomX * denomY);
}

export function spearman(xs: number[], ys: number[]): number {
  if (xs.length === 0 || ys.length === 0 || xs.length !== ys.length) {
    return 0;
  }
  return pearson(rank(xs), rank(ys));
}

export interface CalibrationPoint {
  predicted: number;
  observed: number;
}

export function brierScore(points: CalibrationPoint[]): number {
  if (points.length === 0) return 0;
  return mean(points.map((point) => {
    const error = point.predicted - point.observed;
    return error * error;
  }));
}

export function reliabilityDiagram(
  points: CalibrationPoint[],
  bucketCount = 10
): CalibrationBucket[] {
  if (points.length === 0) {
    return [];
  }

  const safeBucketCount = Math.max(bucketCount, 1);
  const buckets: CalibrationBucket[] = [];

  for (let index = 0; index < safeBucketCount; index++) {
    const lowerBound = index / safeBucketCount;
    const upperBound = index === safeBucketCount - 1 ? 1 : (index + 1) / safeBucketCount;
    const bucketPoints = points.filter((point) => {
      if (index === safeBucketCount - 1) {
        return point.predicted >= lowerBound && point.predicted <= upperBound;
      }
      return point.predicted >= lowerBound && point.predicted < upperBound;
    });
    const sampleCount = bucketPoints.length;
    const observedCount = bucketPoints.filter((point) => point.observed === 1).length;
    const meanPredictedRisk = sampleCount === 0 ? 0 : mean(bucketPoints.map((point) => point.predicted));
    const observedRate = sampleCount === 0 ? 0 : observedCount / sampleCount;
    const confidenceInterval = wilsonInterval(observedCount, sampleCount);

    buckets.push({
      index,
      lowerBound,
      upperBound,
      sampleCount,
      meanPredictedRisk,
      observedRate,
      absoluteGap: Math.abs(meanPredictedRisk - observedRate),
      confidenceInterval,
    });
  }

  return buckets;
}

export function expectedCalibrationError(
  points: CalibrationPoint[],
  bucketCount = 10
): number {
  if (points.length === 0) return 0;

  const buckets = reliabilityDiagram(points, bucketCount);
  return buckets.reduce((sum, bucket) => {
    if (bucket.sampleCount === 0) {
      return sum;
    }
    return sum + (bucket.sampleCount / points.length) * bucket.absoluteGap;
  }, 0);
}

export function wilsonInterval(
  successes: number,
  trials: number,
  z = 1.96
): { lo: number; hi: number } {
  if (trials <= 0) {
    return { lo: 0, hi: 0 };
  }

  const p = successes / trials;
  const denom = 1 + (z * z) / trials;
  const center = (p + (z * z) / (2 * trials)) / denom;
  const spread = (z / denom) * Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials));

  return {
    lo: Math.max(0, center - spread),
    hi: Math.min(1, center + spread),
  };
}

/** 标准正态 CDF（Abramowitz-Stegun 7.1.26 近似） */
export function normalCdf(value: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(value));
  const d = 0.3989423 * Math.exp((-value * value) / 2);
  const prob =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return value >= 0 ? 1 - prob : prob;
}

export interface WilcoxonResult {
  n: number;
  statistic: number;
  z: number;
  pValue: number;
  meanDifference: number;
  medianDifference: number;
}

/**
 * 配对 Wilcoxon signed-rank 检验（正态近似，带连续性校正）。
 *
 * 论文 v8 用 task-grouped paired Wilcoxon 检验系统分离。n 为任务对数；
 * 对 n < 10 的正态近似只作参考，报告时应同时给出 bootstrap CI。
 */
export function wilcoxonSignedRank(a: number[], b: number[]): WilcoxonResult {
  const nPair = Math.min(a.length, b.length);
  const diffs: number[] = [];
  for (let index = 0; index < nPair; index++) {
    const diff = a[index] - b[index];
    if (Math.abs(diff) > 1e-12) diffs.push(diff);
  }
  const n = diffs.length;
  if (n === 0) {
    return { n: 0, statistic: 0, z: 0, pValue: 1, meanDifference: 0, medianDifference: 0 };
  }

  const ordered = diffs
    .map((diff, index) => ({ diff, abs: Math.abs(diff), index }))
    .sort((left, right) => left.abs - right.abs);

  const ranks = new Array<number>(n);
  let cursor = 0;
  while (cursor < ordered.length) {
    let end = cursor + 1;
    while (end < ordered.length && Math.abs(ordered[end].abs - ordered[cursor].abs) < 1e-12) {
      end++;
    }
    const averageRank = (cursor + 1 + end) / 2;
    for (let position = cursor; position < end; position++) {
      ranks[position] = averageRank;
    }
    cursor = end;
  }

  let wPlus = 0;
  let wMinus = 0;
  ordered.forEach((entry, position) => {
    if (entry.diff > 0) wPlus += ranks[position];
    else wMinus += ranks[position];
  });
  const statistic = Math.min(wPlus, wMinus);

  const expected = (n * (n + 1)) / 4;
  const variance = (n * (n + 1) * (2 * n + 1)) / 24;
  const z = variance > 0 ? (statistic - expected + 0.5) / Math.sqrt(variance) : 0;
  const pValue = Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));

  const sortedDiffs = [...diffs].sort((left, right) => left - right);
  const medianDifference =
    sortedDiffs.length % 2 === 1
      ? sortedDiffs[(sortedDiffs.length - 1) / 2]
      : (sortedDiffs[sortedDiffs.length / 2 - 1] + sortedDiffs[sortedDiffs.length / 2]) / 2;

  return {
    n,
    statistic,
    z,
    pValue,
    meanDifference: mean(diffs),
    medianDifference,
  };
}
