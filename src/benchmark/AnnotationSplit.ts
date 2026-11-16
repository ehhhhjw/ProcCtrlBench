import { AnnotatedCase } from '../adapters/AnnotationLoader';
import { Rng, createSeededRng } from './Stats';

/**
 * 标注集的分层划分（论文附录 B.4）。
 *
 * 200 条标注样本划分为 80 development / 40 calibration / 80 evaluation，
 * 按 benchmark 来源与端点任务成败双重分层，避免校准与最终评估被单一任务
 * 形态主导。
 *
 * 阈值只在 development 上调优，后验风险映射只在 calibration 上拟合，
 * 最终指标只在 evaluation 上报告——这三条约束由 assertSplitDiscipline 检查。
 */

export type SplitName = 'development' | 'calibration' | 'evaluation';

export const SPLIT_NAMES: readonly SplitName[] = ['development', 'calibration', 'evaluation'];

/** 论文使用的划分规模 */
export const PAPER_SPLIT_SIZES: Record<SplitName, number> = {
  development: 80,
  calibration: 40,
  evaluation: 80,
};

export interface SplitOptions {
  /** 各划分的目标样本数；默认使用论文的 80 / 40 / 80 */
  sizes?: Partial<Record<SplitName, number>>;
  /** 随机种子，保证划分可复现 */
  seed?: number;
  /**
   * 分层键的构造方式，默认为 `${benchmark}|${successBucket}`。
   * successBucket 取 success / failure / unknown。
   */
  stratumKey?: (annotatedCase: AnnotatedCase) => string;
}

export interface SplitAssignment {
  caseId: string;
  split: SplitName;
  stratum: string;
}

export interface SplitResult {
  assignments: SplitAssignment[];
  /** caseId -> split，便于快速查询 */
  splitByCaseId: Record<string, SplitName>;
  /** 各划分实际样本数 */
  counts: Record<SplitName, number>;
  /** 各划分内的分层分布，用于核对分层是否均衡 */
  stratumCounts: Record<SplitName, Record<string, number>>;
  /** 目标规模与实际规模不一致时的说明 */
  notes: string[];
}

export function defaultStratumKey(annotatedCase: AnnotatedCase): string {
  const bucket =
    annotatedCase.success === true ? 'success' : annotatedCase.success === false ? 'failure' : 'unknown';
  return `${annotatedCase.benchmark}|${bucket}`;
}

/** Fisher-Yates 洗牌，使用可复现 rng */
function shuffle<T>(values: T[], rng: Rng): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const swapWith = Math.floor(rng() * (index + 1));
    [result[index], result[swapWith]] = [result[swapWith], result[index]];
  }
  return result;
}

/**
 * 按最大余数法把一个分层内的样本按目标比例分配到三个划分。
 * 保证分配总数恰好等于该分层的样本数。
 */
function allocateWithinStratum(
  stratumSize: number,
  ratios: Record<SplitName, number>
): Record<SplitName, number> {
  const raw = {} as Record<SplitName, number>;
  const floored = {} as Record<SplitName, number>;
  let assigned = 0;

  for (const split of SPLIT_NAMES) {
    raw[split] = stratumSize * ratios[split];
    floored[split] = Math.floor(raw[split]);
    assigned += floored[split];
  }

  let remaining = stratumSize - assigned;
  const byRemainder = [...SPLIT_NAMES].sort(
    (left, right) => raw[right] - floored[right] - (raw[left] - floored[left])
  );
  let cursor = 0;
  while (remaining > 0) {
    floored[byRemainder[cursor % byRemainder.length]]++;
    cursor++;
    remaining--;
  }

  return floored;
}

/**
 * 生成分层划分。
 *
 * 当实际样本数不等于目标总数（例如标注集尚未标满 200 条）时，按目标比例
 * 等比缩放，并在 notes 中记录，避免静默产出规模不符的划分。
 */
export function splitAnnotatedCases(
  cases: AnnotatedCase[],
  options?: SplitOptions
): SplitResult {
  const sizes: Record<SplitName, number> = {
    development: options?.sizes?.development ?? PAPER_SPLIT_SIZES.development,
    calibration: options?.sizes?.calibration ?? PAPER_SPLIT_SIZES.calibration,
    evaluation: options?.sizes?.evaluation ?? PAPER_SPLIT_SIZES.evaluation,
  };
  const targetTotal = SPLIT_NAMES.reduce((sum, split) => sum + sizes[split], 0);
  const notes: string[] = [];

  if (targetTotal <= 0) {
    throw new Error('Split sizes must sum to a positive number');
  }
  if (cases.length !== targetTotal) {
    notes.push(
      `Annotated set holds ${cases.length} cases but the requested split totals ${targetTotal}; ` +
        'sizes were rescaled proportionally.'
    );
  }

  const ratios = {} as Record<SplitName, number>;
  for (const split of SPLIT_NAMES) {
    ratios[split] = sizes[split] / targetTotal;
  }

  const keyFn = options?.stratumKey ?? defaultStratumKey;
  const rng = createSeededRng(options?.seed ?? 20270101);

  const strata = new Map<string, AnnotatedCase[]>();
  for (const annotatedCase of cases) {
    const key = keyFn(annotatedCase);
    const bucket = strata.get(key);
    if (bucket) bucket.push(annotatedCase);
    else strata.set(key, [annotatedCase]);
  }

  const assignments: SplitAssignment[] = [];
  const counts = { development: 0, calibration: 0, evaluation: 0 } as Record<SplitName, number>;
  const stratumCounts = {
    development: {},
    calibration: {},
    evaluation: {},
  } as Record<SplitName, Record<string, number>>;

  // 分层键排序，确保与插入顺序无关，划分完全由种子决定
  for (const key of [...strata.keys()].sort()) {
    const bucket = shuffle(strata.get(key)!, rng);
    const allocation = allocateWithinStratum(bucket.length, ratios);

    let cursor = 0;
    for (const split of SPLIT_NAMES) {
      for (let taken = 0; taken < allocation[split]; taken++) {
        const annotatedCase = bucket[cursor++];
        assignments.push({ caseId: annotatedCase.caseId, split, stratum: key });
        counts[split]++;
        stratumCounts[split][key] = (stratumCounts[split][key] || 0) + 1;
      }
    }
  }

  // 分层内最大余数法可能让各 split 的总数相对目标漂移 1-2 条。
  // 论文要求精确的 80/40/80，因此在层内做“等量交换”把总数拉回目标：
  // 从超额 split 与不足 split 各取一条同一分层的样本，交换其 split。
  // 交换保持每个分层的样本总数不变，只修正总量。
  const byStratum = new Map<string, Record<SplitName, SplitAssignment[]>>();
  for (const assignment of assignments) {
    let bucket = byStratum.get(assignment.stratum);
    if (!bucket) {
      bucket = {
        development: [],
        calibration: [],
        evaluation: [],
      };
      byStratum.set(assignment.stratum, bucket);
    }
    bucket[assignment.split].push(assignment);
  }

  let rebalanced = 0;
  for (let guard = 0; guard < assignments.length; guard++) {
    const excess = SPLIT_NAMES.find((split) => counts[split] > sizes[split]);
    const deficit = SPLIT_NAMES.find((split) => counts[split] < sizes[split]);
    if (!excess || !deficit) break;

    let swapped = false;
    for (const bucket of byStratum.values()) {
      if (bucket[excess].length > 0 && bucket[deficit].length > 0) {
        const from = bucket[excess].pop()!;
        const to = bucket[deficit].pop()!;
        from.split = deficit;
        to.split = excess;
        bucket[deficit].push(from);
        bucket[excess].push(to);
        counts[excess]--;
        counts[deficit]++;
        rebalanced++;
        swapped = true;
        break;
      }
    }
    if (!swapped) break;
  }
  if (rebalanced > 0) {
    notes.push(
      `Rebalanced ${rebalanced} stratum-internal case(s) to hit the exact ` +
        `${sizes.development}/${sizes.calibration}/${sizes.evaluation} split sizes.`
    );
  }

  // 重新计算 stratified counts，确保交换后的统计准确。
  for (const split of SPLIT_NAMES) {
    stratumCounts[split] = {};
  }
  for (const assignment of assignments) {
    stratumCounts[assignment.split][assignment.stratum] =
      (stratumCounts[assignment.split][assignment.stratum] || 0) + 1;
  }

  const splitByCaseId: Record<string, SplitName> = {};
  for (const assignment of assignments) {
    splitByCaseId[assignment.caseId] = assignment.split;
  }

  for (const split of SPLIT_NAMES) {
    if (counts[split] !== sizes[split] && cases.length === targetTotal) {
      notes.push(
        `Split "${split}" holds ${counts[split]} cases instead of ${sizes[split]}; ` +
          'stratum sizes do not divide evenly at the requested ratio.'
      );
    }
  }

  return { assignments, splitByCaseId, counts, stratumCounts, notes };
}

export interface SplitDisciplineViolation {
  stage: 'threshold-tuning' | 'calibration-fitting' | 'final-evaluation';
  message: string;
  offendingCaseIds: string[];
}

/**
 * 检查划分纪律：阈值调优只能用 development，后验映射只能用 calibration，
 * 最终指标只能用 evaluation。任何越界都会被报出来。
 */
export function assertSplitDiscipline(
  splitByCaseId: Record<string, SplitName>,
  usage: {
    thresholdTuningCaseIds?: string[];
    calibrationFittingCaseIds?: string[];
    finalEvaluationCaseIds?: string[];
  }
): SplitDisciplineViolation[] {
  const violations: SplitDisciplineViolation[] = [];

  const check = (
    stage: SplitDisciplineViolation['stage'],
    caseIds: string[] | undefined,
    allowed: SplitName
  ) => {
    if (!caseIds || caseIds.length === 0) {
      return;
    }
    const offending = caseIds.filter((caseId) => splitByCaseId[caseId] !== allowed);
    if (offending.length > 0) {
      violations.push({
        stage,
        message: `${stage} must only use the "${allowed}" split, but ${offending.length} case(s) came from elsewhere`,
        offendingCaseIds: offending,
      });
    }
  };

  check('threshold-tuning', usage.thresholdTuningCaseIds, 'development');
  check('calibration-fitting', usage.calibrationFittingCaseIds, 'calibration');
  check('final-evaluation', usage.finalEvaluationCaseIds, 'evaluation');

  return violations;
}
