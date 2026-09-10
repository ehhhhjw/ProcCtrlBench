import {
  DetectionIssue,
  EvaluationReport,
  ExecutionGuidanceAction,
  Severity,
} from '../../../src/types/evaluation.types';

export const BENCHMARK_IDS = [
  'ghostContext',
  'oversizedRules',
  'contextThrashing',
  'toolCallChain',
  'deadStep',
  'duplicateStep',
  'wrapperWorkflow',
  'contextCoupling',
  'longChain',
  'inconsistentToolInterface',
  'weakTool',
] as const;

export type BenchmarkId = typeof BENCHMARK_IDS[number];

export type GuardMode = 'observe' | 'warn' | 'guard' | 'remediate';

export interface BenchmarkGuardSettings {
  enabled: boolean;
  mode: GuardMode;
  cooldownSteps: number;
  blockOnError: boolean;
  thresholds: Record<string, unknown>;
  specialRules?: Record<string, unknown>;
}

export interface GuardConfig {
  enabled: boolean;
  mode: GuardMode;
  runtime: {
    analysisRootDir: string;
    transport: {
      useHooks: boolean;
      useTranscriptTailing: boolean;
      watchSubagents: boolean;
    };
    sources: {
      projectAstPath: string;
      fileGraphPath: string;
      relatedFilesDataPath: string;
      calibrationProfilePath?: string;
      sessionStateDir: string;
      alertOutputDir: string;
      remediationOutputDir: string;
    };
    actions: {
      emitStdout: boolean;
      emitStderr: boolean;
      writeAlertFiles: boolean;
      writeRemediationFiles: boolean;
      injectPromptSuggestions: boolean;
      blockHighRiskPreToolUse: boolean;
    };
  };
  benchmarks: Record<BenchmarkId, BenchmarkGuardSettings>;
}

export interface AnalysisRequest {
  transcriptPath: string;
  sessionId?: string;
  hookEventName?: string;
  cwd?: string;
}

export interface AnalysisSnapshot {
  transcriptPath: string;
  sessionId: string;
  lineCount: number;
  issues: DetectionIssue[];
  report?: EvaluationReport;
  detectorErrors: string[];
}

export interface HookPayload {
  hook_event_name?: string;
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  permission_mode?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_use_id?: string;
  agent_id?: string;
  agent_type?: string;
}

export interface BenchmarkPlannerContext {
  issue: DetectionIssue;
  settings: BenchmarkGuardSettings;
  config: GuardConfig;
  report?: EvaluationReport;
  hookEventName?: string;
}

export interface BenchmarkPlan {
  summary: string;
  suggestion?: string;
  prompt?: string;
  shouldBlock: boolean;
  tags: string[];
}

export interface BenchmarkPlanner {
  readonly benchmark: BenchmarkId;
  plan(context: BenchmarkPlannerContext): BenchmarkPlan | null;
}

export interface GuardAlert {
  id: string;
  benchmark: BenchmarkId;
  severity: Severity;
  mode: GuardMode;
  summary: string;
  suggestion?: string;
  prompt?: string;
  shouldBlock: boolean;
  hookEventName?: string;
  tags: string[];
  riskContext?: {
    overallRisk: number;
    controlPreservation: number;
    autonomyLevel: number;
    guidanceActionTypes: string[];
  };
  sourceIssue: DetectionIssue;
}

export interface PromptInjection {
  benchmark: BenchmarkId | 'report';
  prompt: string;
  reason: string;
  severity: Severity;
}

export interface GuardAnalysisResult {
  sessionId: string;
  transcriptPath: string;
  lineCount: number;
  alerts: GuardAlert[];
  injections: PromptInjection[];
  report?: EvaluationReport;
  guidanceActions: ExecutionGuidanceAction[];
  shouldBlock: boolean;
  blockReasons: string[];
  detectorErrors: string[];
  issuesByBenchmark: Record<string, number>;
  statePath?: string;
}

export interface RuntimeIssueSource {
  analyzeSession(request: AnalysisRequest, config: GuardConfig): Promise<AnalysisSnapshot>;
}

const METRIC_TO_BENCHMARK: Record<string, BenchmarkId> = {
  ghostContext: 'ghostContext',
  oversizedRules: 'oversizedRules',
  thrashing: 'contextThrashing',
  contextThrashing: 'contextThrashing',
  toolCallChain: 'toolCallChain',
  deadStep: 'deadStep',
  duplicateStep: 'duplicateStep',
  wrapperWorkflow: 'wrapperWorkflow',
  contextCoupling: 'contextCoupling',
  longChain: 'longChain',
  inconsistentToolInterface: 'inconsistentToolInterface',
  interfaceInconsistency: 'inconsistentToolInterface',
  weakTool: 'weakTool',
};

export function metricToBenchmarkId(metric: string): BenchmarkId | null {
  return METRIC_TO_BENCHMARK[metric] || null;
}
