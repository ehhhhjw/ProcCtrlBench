import { EvaluationConfig } from '../types/evaluation.types';

/**
 * Default evaluation configuration
 */
export const DEFAULT_EVALUATION_CONFIG: EvaluationConfig = {
  // Threshold configuration
  thresholds: {
    ghostContext: {
      warningTokens: 512,
      errorTokens: 1024,
    },
    oversizedRules: {
      warningTokens: 2000,
      errorTokens: 4000,
      warningRatio: 0.20,
      errorRatio: 0.35,
    },
    thrashing: {
      windowThreshold: 0.75, // 75% window occupancy (per the validated spec, prewarn early)
      compressionLookAhead: 2, // Look ahead 2 steps
    },
    toolChain: {
      repetitiveWarningCount: 6,
      repetitiveErrorCount: 10,
      cyclicWarningCount: 3,
      cyclicErrorCount: 5,
    },
    longChain: {
      warningLength: 12,
      errorLength: 20,
      simpleWarningLength: 25,
      simpleErrorLength: 40,
    },
  },
  // Context window size (the window size of Claude 4.6 Opus)
  contextWindowSize: 200000,
  riskModel: {
    // 论文 v8 附录 A.5 固定 error band 阈值 delta_e = 0.70；
    // warning band 下界论文未给出唯一值，沿用 0.55。
    warningThreshold: 0.55,
    errorThreshold: 0.7,
    calibrationBucketCount: 10,
    metricPriors: {
      ghostContext: 0.42,
      oversizedRules: 0.32,
      thrashing: 0.38,
      toolCallChain: 0.4,
      deadStep: 0.36,
      duplicateStep: 0.38,
      wrapperWorkflow: 0.28,
      contextCoupling: 0.34,
      longChain: 0.44,
      inconsistentToolInterface: 0.3,
      weakTool: 0.27,
    },
    evidenceWeights: {
      weak: 0.35,
      medium: 0.6,
      strong: 0.82,
    },
    severityAnchors: {
      info: 0.2,
      warning: 0.6,
      error: 0.82,
      critical: 0.92,
    },
  },
  controlPreservation: {
    // 论文 v8 附录 A.5：五个子维度等权 w_k = 0.20。
    weights: {
      interpretability: 0.2,
      interruptibility: 0.2,
      corrigibility: 0.2,
      reversibility: 0.2,
      handoffAwareness: 0.2,
    },
  },
  detectorCalibration: {
    profileName: 'default-heuristic-v1',
    calibrationSource: 'built-in-defaults',
    baselineScores: {
      ghostContext: 0.34,
      oversizedRules: 0.26,
      thrashing: 0.33,
      toolCallChain: 0.31,
      deadStep: 0.28,
      duplicateStep: 0.27,
      wrapperWorkflow: 0.24,
      contextCoupling: 0.25,
      longChain: 0.36,
      inconsistentToolInterface: 0.23,
      weakTool: 0.22,
    },
  },
};
