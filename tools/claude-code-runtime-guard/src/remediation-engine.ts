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
        return '先压缩并总结当前上下文，只保留和下一步直接相关的事实，再继续工具调用。';
      case 'create-checkpoint':
        return '先建立 checkpoint：已完成、未完成、下一步唯一目标。没有 checkpoint 不要继续扩展链路。';
      case 'verify-before-next-step':
        return '下一步前先验证当前结果是否真的改变了状态，避免重复调用或空转。';
      case 'request-confirmation':
        return '当前风险高且控制保持不足。先暴露关键分支和风险，再请求上层确认。';
      case 'handoff':
        return '当前自治推进已接近失控边界。请立即收敛并切换到人工接管或更强监督模式。';
      default:
        return '根据当前风险状态先收敛上下文，再继续执行。';
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
