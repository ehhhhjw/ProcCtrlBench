import { RuntimeGuardEngine } from './guard-engine';
import { GuardAnalysisResult, GuardConfig, HookPayload } from './types';

export class HookProcessor {
  private readonly engine: RuntimeGuardEngine;
  private readonly config: GuardConfig;

  constructor(config: GuardConfig, engine: RuntimeGuardEngine = new RuntimeGuardEngine()) {
    this.config = config;
    this.engine = engine;
  }

  async processHook(payload: HookPayload): Promise<GuardAnalysisResult> {
    if (!payload.transcript_path) {
      throw new Error('Hook payload missing transcript_path');
    }

    return this.engine.analyze(
      {
        transcriptPath: payload.transcript_path,
        sessionId: payload.session_id,
        hookEventName: payload.hook_event_name,
        cwd: payload.cwd,
      },
      this.config
    );
  }
}
