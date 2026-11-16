/**
 * Metric-related type definitions
 */

/**
 * Tool call chain information
 */
export interface ToolChainInfo {
  toolName: string;
  consecutiveCount: number;
  startStep: number;
  endStep: number;
  inputs: any[];
}

/**
 * Cyclic call information
 */
export interface CyclicChainInfo {
  pattern: string[];
  cycleCount: number;
  startStep: number;
  endStep: number;
}

/**
 * Ghost Context information
 */
export interface GhostContextInfo {
  type: 'summary_duplication' | 'unusable_payload' | 'unreferenced_history';
  messageUuid: string;
  tokenSize: number;
  retentionSteps: number;
  details: string;
}

/**
 * Context thrashing information
 */
export interface ThrashingInfo {
  type: 'timing_fault' | 'payload_oversize_fault';
  stepId: number;
  tokensBefore: number;
  tokensAfter: number;
  payloadSize: number;
  windowCapacity: number;
  compressionDelay: number;
}

/**
 * Dead Step information
 */
export interface DeadStepInfo {
  stepId: number;
  toolName: string;
  evidenceStrength: 'strong' | 'medium' | 'weak';
  checks: {
    noToolInputRef: boolean;
    noPlanRef: boolean;
    noFileRef: boolean;
    noBranchImpact: boolean;
  };
}

/**
 * Duplicate step information
 */
export interface DuplicateStepInfo {
  type: 'exact' | 'near' | 'context_loss';
  currentStep: number;
  previousStep: number;
  toolName: string;
  inputSimilarity: number;
  resultSimilarity: number;
  timeDelta: number;
}

/**
 * Wrapper Workflow information
 */
export interface WrapperWorkflowInfo {
  agentId: string;
  agentName?: string;
  internalSteps: number;
  downstreamToolType: string;
  inputSimilarity: number;
  outputSimilarity: number;
  wrapperRate: number;
}

/**
 * Context coupling information
 */
export interface ContextCouplingInfo {
  type: 'scc' | 'back_edge' | 'alternating_pattern';
  components?: string[][];
  pattern?: string[];
  patternCount?: number;
}

/**
 * Long chain information
 */
export interface LongChainInfo {
  totalSteps: number;
  subtaskCount: number;
  checkpointCount: number;
  effectiveLength: number;
}

/**
 * Inconsistent tool interface information
 */
export interface InconsistentToolInfo {
  cluster: string[];
  schemaDifference: number;
  examples: Array<{
    tool: string;
    schema: any;
  }>;
}

/**
 * Weak tool information
 */
export interface WeakToolInfo {
  toolName: string;
  callRate: number;
  suitableTaskCount: number;
  actualCallCount: number;
  alternativeTools?: Array<{
    name: string;
    callRate: number;
  }>;
}

/**
 * Similarity computation result
 */
export interface SimilarityResult {
  similarity: number;
  method: 'exact' | 'levenshtein' | 'cosine' | 'structural';
}
