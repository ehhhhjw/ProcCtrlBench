/**
 * Agent execution process evaluation system
 * Main export file
 */

export { AgentEvaluator } from './AgentEvaluator';
export { ScoreCalculator } from './scoring/ScoreCalculator';
export { ReportGenerator } from './scoring/ReportGenerator';
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

// Type definitions
export * from './types/evaluation.types';
export * from './types/metrics.types';
export * from './types/project-analysis.types';

// Configuration
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

// Evaluators
export { BaseEvaluator } from './evaluators/BaseEvaluator';
export { ToolUseEfficiencyEvaluator } from './evaluators/ToolUseEfficiencyEvaluator';
export { WorkflowArchitectureEvaluator } from './evaluators/WorkflowArchitectureEvaluator';
export { ContextManagementEvaluator } from './evaluators/ContextManagementEvaluator';
export { ToolEcosystemEvaluator } from './evaluators/ToolEcosystemEvaluator';
export { TaskOutcomeEvaluator } from './evaluators/TaskOutcomeEvaluator';

// Detectors
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

// Analyzers
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
