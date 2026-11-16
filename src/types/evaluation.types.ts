/**
 * Core type definitions for the evaluation system
 */

/**
 * Warning severity levels
 */
export enum Severity {
  Info = 'info',
  Warning = 'warning',
  Error = 'error',
  Critical = 'critical'
}

export type EvaluationDimensionKey =
  | 'taskOutcome'
  | 'contextManagement'
  | 'toolUseEfficiency'
  | 'workflowArchitecture'
  | 'toolEcosystemConsistency';

export type ProcessDimensionKey = Exclude<EvaluationDimensionKey, 'taskOutcome'>;

export interface DetectorThresholdSummary {
  warning?: number;
  error?: number;
  [key: string]: number | string | boolean | undefined;
}

export interface DetectorExemption {
  code: string;
  reason: string;
  matched: boolean;
  source?: string;
}

export interface DetectorDecisionStep {
  stage: 'signal' | 'normalization' | 'evidence' | 'severity' | 'score';
  detail: string;
  value?: number | string | boolean;
}

export interface DetectorEvidenceDetails extends Record<string, any> {
  schemaVersion?: string;
  canonicalMetric?: string;
  signalType?: string;
  signalSource?: string;
  thresholds?: DetectorThresholdSummary;
  exemptions?: DetectorExemption[];
  candidateCount?: number;
  decisionPath?: DetectorDecisionStep[];
  nativeDetectorScore?: number;
}

export interface DetectionEvidence {
  type: 'strong' | 'medium' | 'weak';
  details: DetectorEvidenceDetails;
}

export interface CalibrationBucket {
  index: number;
  lowerBound: number;
  upperBound: number;
  sampleCount: number;
  meanPredictedRisk: number;
  observedRate: number;
  absoluteGap: number;
  confidenceInterval?: {
    lo: number;
    hi: number;
  };
}

export interface CalibrationSummary {
  bucketCount: number;
  sampleCount: number;
  labelDefinition: string;
  meanPredictedRisk: number;
  observedPositiveRate: number;
  expectedCalibrationError: number;
  maxCalibrationGap: number;
  brierScore: number;
  buckets: CalibrationBucket[];
}

export interface DetectorCalibrationProfile {
  profileName?: string;
  source?: string;
  metadata?: {
    totalFindings?: number;
    labelMode?: string;
    shrinkage?: number;
    generatedAt?: string;
    calibration?: CalibrationSummary;
    metricSampleCounts?: Record<string, number>;
  };
  riskModel?: {
    metricPriors?: Record<string, number>;
    evidenceWeights?: Partial<Record<'weak' | 'medium' | 'strong', number>>;
    severityAnchors?: Partial<Record<Severity, number>>;
    calibrationBucketCount?: number;
  };
  detectorCalibration?: {
    baselineScores?: Record<string, number>;
  };
}

/**
 * A detected issue
 */
export interface DetectionIssue {
  metric: string;
  severity: Severity;
  message: string;
  location?: {
    stepRange?: [number, number];
    messageUuid?: string;
    toolUseId?: string;
  };
  suggestion?: string;
  evidence?: DetectionEvidence;
  baselineRisk?: number;
  baselineScore?: number;
  rawSignal?: number;
  normalizedSignal?: number;
  detectorScore?: number;
  exemptionsApplied?: string[];
  deduction: number; // Internal severity weight, no longer used for external scoring
}

export interface ProcessFinding {
  metric: string;
  dimension: ProcessDimensionKey;
  severity: Severity;
  riskSeverity: Severity;
  message: string;
  location?: DetectionIssue['location'];
  suggestion?: string;
  evidence?: DetectionEvidence;
  baselineRisk: number;
  baselineScore: number;
  rawSignal: number;
  normalizedSignal: number;
  detectorScore: number;
  posteriorRisk: number;
  evidenceStrength: number;
  exemptionsApplied: string[];
  conditionSignals: Record<string, any>;
}

export interface RiskMetricSummary extends MetricSummary {
  averageDetectorScore: number;
  averagePosteriorRisk: number;
  maxPosteriorRisk: number;
}

export interface RiskSummary {
  model: {
    kind: string;
    warningThreshold: number;
    errorThreshold: number;
  };
  calibration: CalibrationSummary;
  overallRisk: number;
  averagePosteriorRisk: number;
  findingCount: number;
  warningFindings: number;
  errorFindings: number;
  topRiskFindings: string[];
  dimensions: Record<ProcessDimensionKey, RiskMetricSummary>;
}

export interface ControlPreservationMetrics {
  interpretability: number;
  interruptibility: number;
  corrigibility: number;
  reversibility: number;
  handoffAwareness: number;
}

export interface ControlPreservationSummary {
  score: number;
  level: 'strong' | 'moderate' | 'fragile';
  metrics: ControlPreservationMetrics;
  evidence: string[];
}

export interface ExecutionGuidanceAction {
  type:
    | 'continue'
    | 'summarize-context'
    | 'create-checkpoint'
    | 'verify-before-next-step'
    | 'request-confirmation'
    | 'handoff';
  reason: string;
  triggeredBy: string[];
}

export interface ExecutionGuidanceSummary {
  autonomyLevel: number;
  recommendedActions: ExecutionGuidanceAction[];
  rationale: string[];
}

export interface ExecutionContextSummary {
  totalMessages: number;
  totalToolUses: number;
  totalAgents: number;
  totalBranches: number;
  userMessages: number;
  assistantMessages: number;
  verificationAttempts: number;
  successfulVerifications: number;
  failedToolCalls: number;
  successfulToolCalls: number;
  checkpointSignals: number;
  handoffSignals: number;
}

/**
 * Evaluator interface
 */
export interface IEvaluator {
  /**
   * Evaluator name
   */
  readonly name: string;

  /**
   * Evaluator description
   */
  readonly description: string;

  /**
   * Runs the evaluation
   */
  evaluate(): Promise<EvaluationResult>;
}

/**
 * Evaluation result
 */
export interface EvaluationResult {
  dimension: string;
  warnings: number;
  errors: number;
  issues: DetectionIssue[];
  details: Record<string, any>;
}

export interface ContextChainStepAnalysis {
  messageUuid: string;
  messageId?: string;
  parentUuid?: string | null;
  timestamp: number;
  type: 'user' | 'assistant' | 'system' | 'attachment';
  agentId?: string;
  isSidechain?: boolean;
  chainUuids: string[];
  chainLength: number;
  contextTokensBefore: number;
  contextTokensAfter: number;
}

export interface ContextChainAnalysisSummary {
  enabled: boolean;
  analyzedSteps: number;
  averageChainLength: number;
  maxChainLength: number;
  averageContextTokensBefore: number;
  maxContextTokensBefore: number;
  outputPath?: string;
  contextChainMapPath?: string;
}

export interface EventStreamAnalysisSummary {
  enabled: boolean;
  totalEvents: number;
  messageEvents: number;
  toolCallEvents: number;
  toolResultEvents: number;
  compressedEvents: number;
  actorCounts: Record<string, number>;
  eventTypeCounts: Record<string, number>;
  outputPath?: string;
}

/**
 * Detector interface
 */
export interface IDetector {
  /**
   * Detector name
   */
  readonly name: string;

  /**
   * Runs the detection
   */
  detect(): Promise<DetectionIssue[]>;
}

/**
 * An issue as exposed in the external report
 */
export interface ReportedIssue extends Omit<DetectionIssue, 'deduction'> {}

/**
 * Metric summary
 */
export interface MetricSummary {
  warnings: number;
  errors: number;
}

/**
 * Dimension summary
 */
export interface DimensionSummary {
  warnings: number;
  errors: number;
  details: Record<string, any>;
}

/**
 * The complete evaluation report
 */
export interface EvaluationReport {
  runId: string;
  timestamp: string;
  analysis?: {
    contextChains?: ContextChainAnalysisSummary;
    standardEventStream?: EventStreamAnalysisSummary;
  };
  dimensions: {
    taskOutcome: DimensionSummary & {
      details: {
        taskCompletionRate: number;
        outputExecutability: number;
        postModificationVerificationRate: number;
      };
    };
    contextManagement: DimensionSummary & {
      details: {
        ghostContext: MetricSummary;
        oversizedRules: MetricSummary;
        thrashing: MetricSummary;
      };
    };
    toolUseEfficiency: DimensionSummary & {
      details: {
        toolCallChain: MetricSummary;
        deadStep: MetricSummary;
        duplicateStep: MetricSummary;
      };
    };
    workflowArchitecture: DimensionSummary & {
      details: {
        wrapperWorkflow: MetricSummary;
        contextCoupling: MetricSummary;
        longChain: MetricSummary;
      };
    };
    toolEcosystemConsistency: DimensionSummary & {
      details: {
        inconsistentToolInterface: MetricSummary;
        weakTool: MetricSummary;
      };
    };
  };
  diagnostics: ReportedIssue[];
  findings: ProcessFinding[];
  risk: RiskSummary;
  controlPreservation: ControlPreservationSummary;
  /** 当前 CP 的来源：legacy 启发式或论文 Appendix A.5 */
  controlPreservationSource?: 'legacy' | 'paper-appendix-a5';
  /** 论文 Appendix C.10 的纯特征 CPraw（去掉 p_j 惩罚项） */
  controlPreservationRawScore?: number;
  /** 论文口径 CP 的原始特征计数，便于审计 */
  controlPreservationFeatures?: Record<string, number>;
  executionGuidance: ExecutionGuidanceSummary;
  summary: {
    totalWarnings: number;
    totalErrors: number;
    keyIssues: string[];
    strengths: string[];
  };
}

/**
 * The normalized event stream
 */
export interface EvaluationEvent {
  run_id: string;
  step_id: number;
  timestamp: number;
  actor: 'agent' | 'skill' | 'workflow' | 'tool' | 'user' | 'assistant' | 'system';
  actor_name: string;
  event_type: 'thought' | 'tool_call' | 'tool_result' | 'message';
  tool_name?: string;
  input_text?: string;
  output_text?: string;
  files_read: string[];
  files_written: string[];
  context_tokens_before: number;
  context_tokens_after: number;
  compressed: boolean;
  parent_step_id?: number;
  messageUuid: string;
  messageId?: string;
  agentId?: string;
  is_error?: boolean;
}

/**
 * Evaluation configuration
 */
/** 论文层次贝叶斯校准参数在评测阶段的最小结构 */
export interface PaperCalibrationParameter {
  alpha: number;
  beta: number;
  gammaByBenchmark: Record<string, number>;
  zMean: number;
  zStd: number;
}

export interface PaperCalibrationConfig {
  /** 当前轨迹所属 benchmark，用于选择 gamma_c,d */
  benchmark?: string;
  defects: Record<string, PaperCalibrationParameter>;
}

export interface EvaluationConfig {
  // Threshold configuration
  thresholds: {
    ghostContext: {
      warningTokens: number;
      errorTokens: number;
    };
    oversizedRules: {
      warningTokens: number;
      errorTokens: number;
      warningRatio: number;
      errorRatio: number;
    };
    thrashing: {
      windowThreshold: number;
      compressionLookAhead: number;
    };
    toolChain: {
      repetitiveWarningCount: number;
      repetitiveErrorCount: number;
      cyclicWarningCount: number;
      cyclicErrorCount: number;
    };
    longChain: {
      warningLength: number;
      errorLength: number;
      simpleWarningLength: number;
      simpleErrorLength: number;
    };
  };
  // Context window size
  contextWindowSize: number;
  riskModel: {
    warningThreshold: number;
    errorThreshold: number;
    calibrationBucketCount: number;
    metricPriors: Record<string, number>;
    evidenceWeights: {
      weak: number;
      medium: number;
      strong: number;
    };
    severityAnchors: Record<Severity, number>;
  };
  controlPreservation: {
    weights: ControlPreservationMetrics;
  };
  detectorCalibration: {
    baselineScores: Record<string, number>;
    profileName?: string;
    calibrationSource?: string;
  };
  /**
   * 可选：论文层次贝叶斯校准参数。提供时，posteriorRisk 由
   * sigmoid(alpha + beta*z + gamma) 计算，而不是默认启发式 logit。
   */
  paperCalibration?: PaperCalibrationConfig;
}
