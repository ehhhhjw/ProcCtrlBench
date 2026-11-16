import { Severity } from '../../../src/types/evaluation.types';
import { GuardAlert, GuardConfig, PromptInjection } from './types';
import { EvaluationReport } from '../../../src/types/evaluation.types';

export class RemediationEngine {
  buildInjections(
    alerts: GuardAlert[],
    config: GuardConfig,
    report?: EvaluationReport
  ): PromptInjection[] {
    if (!config.runtime.actions.injectPromptSuggestions) {
      return [];
    }

    const alertInjections = alerts
      .filter((alert) => Boolean(alert.prompt))
      .map((alert) => ({
        benchmark: alert.benchmark,
        prompt: alert.prompt as string,
        reason: alert.summary,
        severity: alert.severity,
      }));

    const guidanceInjections = (report?.executionGuidance.recommendedActions || [])
      .filter((action) => action.type !== 'continue')
      .map((action) => ({
        benchmark: 'report' as const,
        prompt: this.promptForGuidanceAction(action.type),
        reason: action.reason,
        severity: action.type === 'request-confirmation' || action.type === 'handoff'
          ? Severity.Error
          : Severity.Warning,
      }));

    return dedupeInjections([...alertInjections, ...guidanceInjections]);
  }

  private promptForGuidanceAction(actionType: string): string {
    switch (actionType) {
      case 'summarize-context':
        return 'First compress and summarize the current context, keeping only the facts directly relevant to the next step, then continue with tool calls.';
      case 'create-checkpoint':
        return 'Establish a checkpoint first: what is done, what is not, and the single goal of the next step. Do not keep extending the chain without a checkpoint.';
      case 'verify-before-next-step':
        return 'Before the next step, verify whether the current result actually changed state, to avoid duplicate calls or spinning in place.';
      case 'request-confirmation':
        return 'Risk is high and control preservation is insufficient. Surface the key branches and risks first, then request confirmation from a supervisor.';
      case 'handoff':
        return 'Autonomous progress is approaching the edge of control. Converge immediately and switch to human takeover or a stronger supervision mode.';
      default:
        return 'Converge the context according to the current risk state before continuing execution.';
    }
  }
}

function dedupeInjections(injections: PromptInjection[]): PromptInjection[] {
  const seen = new Set<string>();
  return injections.filter((injection) => {
    const key = `${injection.benchmark}|${injection.reason}|${injection.prompt}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
