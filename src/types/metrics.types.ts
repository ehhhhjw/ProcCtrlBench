/**
 * 指标相关类型定义
 */

/**
 * 工具调用链信息
 */
export interface ToolChainInfo {
  toolName: string;
  consecutiveCount: number;
  startStep: number;
  endStep: number;
  inputs: any[];
}

/**
 * 循环调用信息
 */
export interface CyclicChainInfo {
  pattern: string[];
  cycleCount: number;
  startStep: number;
  endStep: number;
}

/**
 * Ghost Context信息
 */
export interface GhostContextInfo {
  type: 'summary_duplication' | 'unusable_payload' | 'unreferenced_history';
  messageUuid: string;
  tokenSize: number;
  retentionSteps: number;
  details: string;
}

/**
 * 上下文抖动信息
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
 * Dead Step信息
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
 * 重复步骤信息
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
 * Wrapper Workflow信息
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
 * 上下文耦合信息
 */
export interface ContextCouplingInfo {
  type: 'scc' | 'back_edge' | 'alternating_pattern';
  components?: string[][];
  pattern?: string[];
  patternCount?: number;
}

/**
 * 长链信息
 */
export interface LongChainInfo {
  totalSteps: number;
  subtaskCount: number;
  checkpointCount: number;
  effectiveLength: number;
}

/**
 * 工具接口不一致信息
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
 * 弱工具信息
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
 * 相似度计算结果
 */
export interface SimilarityResult {
  similarity: number;
  method: 'exact' | 'levenshtein' | 'cosine' | 'structural';
}
