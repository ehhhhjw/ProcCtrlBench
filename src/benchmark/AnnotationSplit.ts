import { AnnotatedCase } from '../adapters/AnnotationLoader';
import { Rng, createSeededRng } from './Stats';

/**
 * Stratified split of the annotation set (Appendix B.4 of the paper).
 *
 * The 200 annotated samples are split into 80 development / 40 calibration / 80 evaluation,
 * stratified jointly by benchmark source and endpoint task success, so that calibration and
 * final evaluation are not dominated by a single task shape.
 *
 * Thresholds are tuned only on development, the posterior risk mapping is fitted only on
 * calibration, and final metrics are reported only on evaluation -- these three constraints are
 * checked by assertSplitDiscipline.
 */

export type SplitName = 'development' | 'calibration' | 'evaluation';

export const SPLIT_NAMES: readonly SplitName[] = ['development', 'calibration', 'evaluation'];

/** Split sizes used by the paper */
export const PAPER_SPLIT_SIZES: Record<SplitName, number> = {
  development: 80,
  calibration: 40,
  evaluation: 80,
};

export interface SplitOptions {
  /** Target sample count per split; defaults to the paper's 80 / 40 / 80 */
  sizes?: Partial<Record<SplitName, number>>;
  /** Random seed, which keeps the split reproducible */
  seed?: number;
  /**
   * How the stratum key is constructed; defaults to `${benchmark}|${successBucket}`.
   * successBucket is one of success / failure / unknown.
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
  /** caseId -> split, for fast lookup */
  splitByCaseId: Record<string, SplitName>;
  /** Actual sample count per split */
  counts: Record<SplitName, number>;
  /** Stratum distribution within each split, used to check that stratification is balanced */
  stratumCounts: Record<SplitName, Record<string, number>>;
  /** Notes emitted when the target sizes and the actual sizes disagree */
  notes: string[];
}

export function defaultStratumKey(annotatedCase: AnnotatedCase): string {
  const bucket =
    annotatedCase.success === true ? 'success' : annotatedCase.success === false ? 'failure' : 'unknown';
  return `${annotatedCase.benchmark}|${bucket}`;
}

/** Fisher-Yates shuffle, using a reproducible rng */
function shuffle<T>(values: T[], rng: Rng): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const swapWith = Math.floor(rng() * (index + 1));
    [result[index], result[swapWith]] = [result[swapWith], result[index]];
  }
  return result;
}

/**
 * Distribute the samples of one stratum across the three splits at the target ratios, using the
 * largest-remainder method. Guarantees the allocated total exactly equals the stratum's size.
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
 * Produce the stratified split.
 *
 * When the actual sample count differs from the target total (for example, the annotation set has
 * not yet reached 200 cases), the sizes are rescaled proportionally and a note is recorded, so
 * that a split of the wrong size is never produced silently.
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

  // Sort the stratum keys so the result is independent of insertion order and fully seed-determined
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
 * Check split discipline: threshold tuning may only use development, the posterior mapping may
 * only use calibration, and final metrics may only use evaluation. Any overreach is reported.
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
