/**
 * Agent执行过程评估系统
 * 主导出文件
 */

export { AgentEvaluator } from './AgentEvaluator';
export type { AgentEvaluatorOptions } from './AgentEvaluator';
export { ScoreCalculator } from './scoring/ScoreCalculator';
export { ReportGenerator } from './scoring/ReportGenerator';
export {
  computePaperControlPreservation,
} from './benchmark/PaperControlPreservation';
export type {
  PaperControlPreservationOptions,
  PaperControlPreservationResult,
} from './benchmark/PaperControlPreservation';
export {
  CALIBRATION_SCHEMA_VERSION,
  calibratedRisk,
  computeDevelopmentStats,
  fitHierarchicalCalibration,
  validateCalibrationProfile,
} from './benchmark/HierarchicalCalibration';
export type {
  CalibrationSample,
  PaperCalibrationProfile,
} from './benchmark/HierarchicalCalibration';
export {
  DEFAULT_ETA,
  DEFAULT_ERROR_BAND_THRESHOLD,
  DEFAULT_FRAGILE_PB_THRESHOLD,
  DEFAULT_MIN_ERROR_DEFECTS,
  INFRA_DEFECT_KEYS,
  POLICY_DEFECT_KEYS,
  computeInfraQuality,
  computePolicyQuality,
  isFragileSuccess,
} from './benchmark/ProcCtrlScorecard';
export { fitCalibrationProfile, loadReportsFromDirectory } from './benchmark/CalibrationFitter';
export {
  OBSERVED_DEFECT_METRICS,
  aggregateObservedBenchmarkSummaries,
  computeDefectFailureCorrelations,
  computeSweControlSummary,
  computeFragileSuccessRate,
  reportToObservedTrajectoryRecord,
  resolveOutcomeMetric,
} from './benchmark/ObservedBenchmarkExperiments';

// 类型定义
export * from './types/evaluation.types';
export * from './types/metrics.types';
export * from './types/project-analysis.types';

// 配置
export { DEFAULT_EVALUATION_CONFIG } from './config/evaluation.config';
export {
  applyCalibrationProfile,
  applyCalibrationProfileFromFile,
  loadCalibrationProfile,
} from './config/calibration-loader';
export { DEFAULT_PROJECT_ANALYSIS_CONFIG, loadProjectAnalysisConfig } from './config/project-analysis';
export {
  buildBenchmarkLaunchArtifacts,
  loadBenchmarkRunConfig,
  writeBenchmarkLaunchArtifacts,
} from './config/benchmark-run-config';

// 评估器
export { BaseEvaluator } from './evaluators/BaseEvaluator';
export { ToolUseEfficiencyEvaluator } from './evaluators/ToolUseEfficiencyEvaluator';
export { WorkflowArchitectureEvaluator } from './evaluators/WorkflowArchitectureEvaluator';
export { ContextManagementEvaluator } from './evaluators/ContextManagementEvaluator';
export { ToolEcosystemEvaluator } from './evaluators/ToolEcosystemEvaluator';
export { TaskOutcomeEvaluator } from './evaluators/TaskOutcomeEvaluator';

// 检测器
export { ToolChainDetector } from './detectors/ToolChainDetector';
export { DuplicateStepDetector } from './detectors/DuplicateStepDetector';
export { LongChainDetector } from './detectors/LongChainDetector';
export { DeadStepDetector } from './detectors/DeadStepDetector';
export { GhostContextDetector } from './detectors/GhostContextDetector';
export { ThrashingDetector } from './detectors/ThrashingDetector';
export { OversizedRulesDetector } from './detectors/OversizedRulesDetector';
export { WrapperDetector } from './detectors/WrapperDetector';
export { CouplingDetector } from './detectors/CouplingDetector';
export { InterfaceConsistencyDetector } from './detectors/InterfaceConsistencyDetector';
export { WeakToolDetector } from './detectors/WeakToolDetector';

// 分析器
export { EventStreamConverter } from './analyzers/EventStreamConverter';
export { ContextChainAnalyzer } from './analyzers/ContextChainAnalyzer';
export { ContentSimilarityAnalyzer } from './analyzers/ContentSimilarityAnalyzer';
export { CodeContextAnalyzer } from './analyzers/CodeContextAnalyzer';
export { ProjectAstLoader } from './analyzers/ProjectAstLoader';

// Benchmark adapters
export {
  detectBenchmarkSource,
  loadBenchmarkTrajectory,
} from './adapters/BenchmarkTrajectoryLoader';
