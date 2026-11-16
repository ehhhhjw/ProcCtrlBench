import {
  PROCCTRL_DEFECT_KEYS,
  PROCCTRL_TAXONOMY,
  ProcCtrlDefectKey,
  ProcCtrlDimensionKey,
  defectsOfDimension,
} from './ProcCtrlScorecard';

/**
 * 论文 v8 3.4 节的层次贝叶斯校准。
 *
 *   logit(p_i,j) = α_j + β_j · z(s_i,j) + γ_{c,d(j)}
 *
 * - z(s) 只用 80 条 development 轨迹的均值/标准差；
 * - α_j, β_j, γ 只在 40 条 calibration 轨迹上拟合；
 * - exempt 时 z = -5，使 p < 0.01；
 * - β_j 约束为非负。
 *
 * 本实现使用带高斯先验的 MAP（最大后验）估计，并在维度内做经验贝叶斯
 * 更新。它不是 MCMC，但保持论文的参数化、数据划分和单调性约束，
 * 输出可审计的参数文件，供评测阶段直接应用。
 */

export const CALIBRATION_SCHEMA_VERSION = 'procctrlbench-calibration-v1';

export interface CalibrationSample {
  defect: ProcCtrlDefectKey;
  benchmark: string;
  /** 连续证据分 s_j = f_j(φ_j(T)) */
  signal: number;
  /** 人工标注二值标签 y_j（present -> 1） */
  label: boolean;
  /** exempt 判断；exempt 样本不参与拟合，并在应用时 clamp 到 -5 */
  exempt: boolean;
}

export interface CalibrationDefectParam {
  defect: ProcCtrlDefectKey;
  paperName: string;
  dimension: ProcCtrlDimensionKey;
  alpha: number;
  beta: number;
  gammaByBenchmark: Record<string, number>;
  zMean: number;
  zStd: number;
  support: number;
  positives: number;
}

export interface CalibrationHyperparameters {
  alphaPriorMean: Record<ProcCtrlDimensionKey, number>;
  alphaPriorStd: Record<ProcCtrlDimensionKey, number>;
  betaPriorMean: Record<ProcCtrlDimensionKey, number>;
  betaPriorStd: Record<ProcCtrlDimensionKey, number>;
  gammaPriorStd: Record<ProcCtrlDimensionKey, number>;
}

export interface PaperCalibrationProfile {
  schemaVersion: typeof CALIBRATION_SCHEMA_VERSION;
  description?: string;
  seed?: number;
  createdAt?: string;
  errorBandThreshold: number;
  defects: Record<ProcCtrlDefectKey, CalibrationDefectParam>;
  hyperparameters: CalibrationHyperparameters;
  training: {
    devSamples: number;
    calSamples: number;
    calPositives: number;
    benchmarks: string[];
    iterations: number;
  };
}

export interface FitCalibrationOptions {
  seed?: number;
  iterations?: number;
  learningRate?: number;
  empiricalBayesIterations?: number;
  errorBandThreshold?: number;
  hyperparameters?: Partial<CalibrationHyperparameters>;
}

const DEFAULT_HYPERPARAMETERS: CalibrationHyperparameters = {
  alphaPriorMean: {
    contextManagement: -1.0,
    toolUseEfficiency: -0.8,
    workflowArchitecture: -1.2,
    toolEcosystemConsistency: -1.3,
  },
  alphaPriorStd: {
    contextManagement: 1.0,
    toolUseEfficiency: 1.0,
    workflowArchitecture: 1.0,
    toolEcosystemConsistency: 1.0,
  },
  betaPriorMean: {
    contextManagement: 0.8,
    toolUseEfficiency: 0.9,
    workflowArchitecture: 0.7,
    toolEcosystemConsistency: 0.7,
  },
  betaPriorStd: {
    contextManagement: 1.0,
    toolUseEfficiency: 1.0,
    workflowArchitecture: 1.0,
    toolEcosystemConsistency: 1.0,
  },
  gammaPriorStd: {
    contextManagement: 0.6,
    toolUseEfficiency: 0.6,
    workflowArchitecture: 0.6,
    toolEcosystemConsistency: 0.6,
  },
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mu = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - mu) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function normalizeBenchmark(benchmark: string): string {
  return benchmark || 'unknown';
}

/**
 * 计算每个缺陷在 development split 上的 z-normalization 统计量。
 * 没有 dev 样本的缺陷使用全局均值和标准差。
 */
export function computeDevelopmentStats(
  devSamples: CalibrationSample[]
): Record<ProcCtrlDefectKey, { mean: number; std: number }> {
  const allSignals = devSamples.map((sample) => sample.signal);
  const globalMean = mean(allSignals);
  const globalStd = Math.max(stdDev(allSignals), 1e-6);

  const stats = {} as Record<ProcCtrlDefectKey, { mean: number; std: number }>;
  for (const key of PROCCTRL_DEFECT_KEYS) {
    const scoped = devSamples.filter((sample) => sample.defect === key && !sample.exempt);
    const signals = scoped.map((sample) => sample.signal);
    stats[key] = {
      mean: signals.length > 0 ? mean(signals) : globalMean,
      std: signals.length > 0 ? Math.max(stdDev(signals), 1e-6) : globalStd,
    };
  }
  return stats;
}

interface DimensionFitState {
  alphaByDefect: Map<ProcCtrlDefectKey, number>;
  betaByDefect: Map<ProcCtrlDefectKey, number>;
  gammaByBenchmark: Map<string, number>;
}

function fitDimension(
  dimension: ProcCtrlDimensionKey,
  samples: CalibrationSample[],
  stats: Record<ProcCtrlDefectKey, { mean: number; std: number }>,
  hyperparameters: CalibrationHyperparameters,
  options: Required<Pick<FitCalibrationOptions, 'iterations' | 'learningRate'>>
): DimensionFitState {
  const defects = defectsOfDimension(dimension);
  const benchmarks = [...new Set(samples.map((sample) => normalizeBenchmark(sample.benchmark)))].sort();
  const referenceBenchmark = benchmarks[0];

  const alphaByDefect = new Map<ProcCtrlDefectKey, number>();
  const betaByDefect = new Map<ProcCtrlDefectKey, number>();
  const gammaByBenchmark = new Map<string, number>();
  for (const defect of defects) {
    alphaByDefect.set(defect, hyperparameters.alphaPriorMean[dimension]);
    betaByDefect.set(defect, Math.max(0, hyperparameters.betaPriorMean[dimension]));
  }
  for (const benchmark of benchmarks) {
    gammaByBenchmark.set(benchmark, 0);
  }

  const usable = samples.filter(
    (sample) => defects.includes(sample.defect) && !sample.exempt
  );
  if (usable.length === 0) {
    return { alphaByDefect, betaByDefect, gammaByBenchmark };
  }

  const alphaPriorMean = hyperparameters.alphaPriorMean[dimension];
  const alphaPriorVar = hyperparameters.alphaPriorStd[dimension] ** 2;
  const betaPriorMean = hyperparameters.betaPriorMean[dimension];
  const betaPriorVar = hyperparameters.betaPriorStd[dimension] ** 2;
  const gammaPriorVar = hyperparameters.gammaPriorStd[dimension] ** 2;
  const learningRate = options.learningRate;

  for (let iteration = 0; iteration < options.iterations; iteration++) {
    const alphaGrad = new Map<ProcCtrlDefectKey, number>();
    const betaGrad = new Map<ProcCtrlDefectKey, number>();
    const gammaGrad = new Map<string, number>();
    for (const defect of defects) {
      alphaGrad.set(defect, 0);
      betaGrad.set(defect, 0);
    }
    for (const benchmark of benchmarks) {
      gammaGrad.set(benchmark, 0);
    }

    for (const sample of usable) {
      const defect = sample.defect;
      const stat = stats[defect];
      const z = (sample.signal - stat.mean) / stat.std;
      const benchmark = normalizeBenchmark(sample.benchmark);
      const gamma = benchmark === referenceBenchmark ? 0 : gammaByBenchmark.get(benchmark) ?? 0;
      const linear =
        (alphaByDefect.get(defect) ?? 0) +
        Math.max(0, betaByDefect.get(defect) ?? 0) * z +
        gamma;
      const error = sigmoid(linear) - (sample.label ? 1 : 0);

      alphaGrad.set(defect, (alphaGrad.get(defect) ?? 0) + error);
      betaGrad.set(defect, (betaGrad.get(defect) ?? 0) + error * z);
      if (benchmark !== referenceBenchmark) {
        gammaGrad.set(benchmark, (gammaGrad.get(benchmark) ?? 0) + error);
      }
    }

    const n = usable.length;
    for (const defect of defects) {
      const alpha = alphaByDefect.get(defect) ?? 0;
      const beta = betaByDefect.get(defect) ?? 0;
      // MAP 目标：平均对数似然 + 高斯先验。先验项不除以 n，
  // 否则样本量会把正则化稀释掉，导致完全分离时系数发散。
      const alphaStep =
        (alphaGrad.get(defect) ?? 0) / n + (alpha - alphaPriorMean) / alphaPriorVar;
      const betaStep =
        (betaGrad.get(defect) ?? 0) / n + (beta - betaPriorMean) / betaPriorVar;
      alphaByDefect.set(
        defect,
        Math.max(-10, Math.min(10, alpha - learningRate * alphaStep))
      );
      betaByDefect.set(
        defect,
        Math.max(0, Math.min(10, beta - learningRate * betaStep))
      );
    }
    for (const benchmark of benchmarks) {
      if (benchmark === referenceBenchmark) continue;
      const gamma = gammaByBenchmark.get(benchmark) ?? 0;
      const step = (gammaGrad.get(benchmark) ?? 0) / n + gamma / gammaPriorVar;
      gammaByBenchmark.set(
        benchmark,
        Math.max(-5, Math.min(5, gamma - learningRate * step))
      );
    }
  }

  return { alphaByDefect, betaByDefect, gammaByBenchmark };
}

function deriveHyperparameters(
  fitted: Record<ProcCtrlDimensionKey, DimensionFitState>,
  previous: CalibrationHyperparameters
): CalibrationHyperparameters {
  const next: CalibrationHyperparameters = JSON.parse(JSON.stringify(previous));
  for (const dimension of Object.keys(fitted) as ProcCtrlDimensionKey[]) {
    const alphas = [...fitted[dimension].alphaByDefect.values()];
    const betas = [...fitted[dimension].betaByDefect.values()];
    if (alphas.length > 0) {
      next.alphaPriorMean[dimension] = Math.max(-5, Math.min(5, mean(alphas)));
      next.alphaPriorStd[dimension] = Math.max(0.25, Math.min(2, stdDev(alphas)));
    }
    if (betas.length > 0) {
      next.betaPriorMean[dimension] = Math.max(0, Math.min(5, mean(betas)));
      next.betaPriorStd[dimension] = Math.max(0.25, Math.min(2, stdDev(betas)));
    }
  }
  return next;
}

/**
 * 在 dev 上做 z-normalization，在 cal 上拟合 α/β/γ。
 */
export function fitHierarchicalCalibration(
  devSamples: CalibrationSample[],
  calSamples: CalibrationSample[],
  options: FitCalibrationOptions = {}
): PaperCalibrationProfile {
  const iterations = Math.max(50, options.iterations ?? 1500);
  // 经验贝叶斯收紧先验后，先验精度可达 1/0.25^2 = 16；
  // 步长必须相应变小，否则会在 MAP 解附近振荡。
  const learningRate = options.learningRate ?? 0.03;
  const empiricalBayesIterations = Math.max(0, options.empiricalBayesIterations ?? 2);
  const errorBandThreshold = options.errorBandThreshold ?? 0.7;

  const stats = computeDevelopmentStats(devSamples);
  let hyperparameters: CalibrationHyperparameters = {
    ...DEFAULT_HYPERPARAMETERS,
    ...(options.hyperparameters ?? {}),
    alphaPriorMean: {
      ...DEFAULT_HYPERPARAMETERS.alphaPriorMean,
      ...(options.hyperparameters?.alphaPriorMean ?? {}),
    },
    alphaPriorStd: {
      ...DEFAULT_HYPERPARAMETERS.alphaPriorStd,
      ...(options.hyperparameters?.alphaPriorStd ?? {}),
    },
    betaPriorMean: {
      ...DEFAULT_HYPERPARAMETERS.betaPriorMean,
      ...(options.hyperparameters?.betaPriorMean ?? {}),
    },
    betaPriorStd: {
      ...DEFAULT_HYPERPARAMETERS.betaPriorStd,
      ...(options.hyperparameters?.betaPriorStd ?? {}),
    },
    gammaPriorStd: {
      ...DEFAULT_HYPERPARAMETERS.gammaPriorStd,
      ...(options.hyperparameters?.gammaPriorStd ?? {}),
    },
  };

  let fitted: Record<ProcCtrlDimensionKey, DimensionFitState> | undefined;
  for (let round = 0; round <= empiricalBayesIterations; round++) {
    fitted = {
      contextManagement: fitDimension('contextManagement', calSamples, stats, hyperparameters, {
        iterations,
        learningRate,
      }),
      toolUseEfficiency: fitDimension('toolUseEfficiency', calSamples, stats, hyperparameters, {
        iterations,
        learningRate,
      }),
      workflowArchitecture: fitDimension('workflowArchitecture', calSamples, stats, hyperparameters, {
        iterations,
        learningRate,
      }),
      toolEcosystemConsistency: fitDimension(
        'toolEcosystemConsistency',
        calSamples,
        stats,
        hyperparameters,
        { iterations, learningRate }
      ),
    };
    if (round < empiricalBayesIterations) {
      hyperparameters = deriveHyperparameters(fitted, hyperparameters);
    }
  }

  const defects = {} as Record<ProcCtrlDefectKey, CalibrationDefectParam>;
  for (const spec of PROCCTRL_TAXONOMY) {
    const scoped = calSamples.filter((sample) => sample.defect === spec.key && !sample.exempt);
    const dimensionFit = fitted![spec.dimension];
    const gammaByBenchmark: Record<string, number> = {};
    for (const [benchmark, gamma] of dimensionFit.gammaByBenchmark) {
      gammaByBenchmark[benchmark] = gamma;
    }
    defects[spec.key] = {
      defect: spec.key,
      paperName: spec.paperName,
      dimension: spec.dimension,
      alpha: dimensionFit.alphaByDefect.get(spec.key) ?? hyperparameters.alphaPriorMean[spec.dimension],
      beta: Math.max(0, dimensionFit.betaByDefect.get(spec.key) ?? hyperparameters.betaPriorMean[spec.dimension]),
      gammaByBenchmark,
      zMean: stats[spec.key].mean,
      zStd: stats[spec.key].std,
      support: scoped.length,
      positives: scoped.filter((sample) => sample.label).length,
    };
  }

  return {
    schemaVersion: CALIBRATION_SCHEMA_VERSION,
    description:
      'Hierarchical Bayesian MAP calibration fitted on the calibration split; ' +
      'z-normalization statistics come from the development split.',
    seed: options.seed,
    errorBandThreshold,
    defects,
    hyperparameters,
    training: {
      devSamples: devSamples.length,
      calSamples: calSamples.length,
      calPositives: calSamples.filter((sample) => sample.label && !sample.exempt).length,
      benchmarks: [...new Set(calSamples.map((sample) => normalizeBenchmark(sample.benchmark)))].sort(),
      iterations,
    },
  };
}

/**
 * 应用校准参数。exempt 样本按论文 clamp 到 z = -5，使 p < 0.01。
 */
export function calibratedRisk(
  profile: PaperCalibrationProfile,
  defect: ProcCtrlDefectKey,
  signal: number,
  benchmark: string,
  exempt = false
): number {
  const parameter = profile.defects[defect];
  if (!parameter) return 0;
  // 论文语义：exempt = 非缺陷，风险被确定性压到 < 0.01。
  // 直接返回 0.001，避免任意拟合参数把 exempt 重新推高。
  if (exempt) return 0.001;
  const z = (signal - parameter.zMean) / Math.max(parameter.zStd, 1e-6);
  const gamma = parameter.gammaByBenchmark[normalizeBenchmark(benchmark)] ?? 0;
  const linear = parameter.alpha + parameter.beta * z + gamma;
  return Math.min(0.999, Math.max(0.001, sigmoid(linear)));
}

export function validateCalibrationProfile(profile: PaperCalibrationProfile): string[] {
  const errors: string[] = [];
  if (profile.schemaVersion !== CALIBRATION_SCHEMA_VERSION) {
    errors.push(`unsupported schemaVersion: ${String(profile.schemaVersion)}`);
  }
  for (const key of PROCCTRL_DEFECT_KEYS) {
    const parameter = profile.defects?.[key];
    if (!parameter) {
      errors.push(`missing defect parameter: ${key}`);
      continue;
    }
    if (!Number.isFinite(parameter.alpha) || !Number.isFinite(parameter.beta)) {
      errors.push(`non-finite alpha/beta for ${key}`);
    }
    if (parameter.beta < 0) {
      errors.push(`beta must be non-negative for ${key}`);
    }
  }
  return errors;
}