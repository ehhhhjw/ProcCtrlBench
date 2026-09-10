import { DetectionIssue, Severity } from '../../../src/types/evaluation.types';
import {
  BenchmarkId,
  BenchmarkPlanner,
  BenchmarkPlannerContext,
  BenchmarkPlan,
} from './types';

abstract class BasePlanner implements BenchmarkPlanner {
  abstract readonly benchmark: BenchmarkId;
  protected abstract readonly hookEvents: string[];

  plan(context: BenchmarkPlannerContext): BenchmarkPlan | null {
    if (
      context.hookEventName &&
      this.hookEvents.length > 0 &&
      !this.hookEvents.includes(context.hookEventName)
    ) {
      return null;
    }

    return this.createPlan(context);
  }

  protected abstract createPlan(context: BenchmarkPlannerContext): BenchmarkPlan | null;

  protected shouldBlock(context: BenchmarkPlannerContext): boolean {
    if (!context.settings.blockOnError || context.issue.severity !== Severity.Error) {
      return false;
    }
    return !context.hookEventName || ['PreToolUse', 'PreCompact', 'UserPromptSubmit'].includes(context.hookEventName);
  }

  protected defaultSuggestion(issue: DetectionIssue): string | undefined {
    return issue.suggestion;
  }
}

class GhostContextPlanner extends BasePlanner {
  readonly benchmark = 'ghostContext';
  protected readonly hookEvents = ['PreToolUse', 'PreCompact', 'PostToolUse'];

  protected createPlan(context: BenchmarkPlannerContext): BenchmarkPlan {
    return {
      summary: '检测到上下文中存在未被消费的大载荷，建议先压缩再继续。',
      suggestion: this.defaultSuggestion(context.issue) || '保留和当前目标文件、目标符号直接相关的结论，移除原始大块内容。',
      prompt: '请先总结上一段大载荷中与当前目标直接相关的结论，仅保留必要事实，再决定下一步工具调用。',
      shouldBlock: this.shouldBlock(context),
      tags: ['context', 'compression', 'payload'],
    };
  }
}

class OversizedRulesPlanner extends BasePlanner {
  readonly benchmark = 'oversizedRules';
  protected readonly hookEvents = ['SessionStart', 'PreCompact', 'UserPromptSubmit'];

  protected createPlan(context: BenchmarkPlannerContext): BenchmarkPlan {
    return {
      summary: '规则块过大，正在挤压有效执行上下文。',
      suggestion: this.defaultSuggestion(context.issue) || '把长规则改成最小工作集，并把细则下沉到外部文档或按需引用。',
      prompt: '请将当前规则缩减为解决本子问题所必需的最小集合，不要重复注入长篇静态说明。',
      shouldBlock: this.shouldBlock(context),
      tags: ['context', 'rules'],
    };
  }
}

class ContextThrashingPlanner extends BasePlanner {
  readonly benchmark = 'contextThrashing';
  protected readonly hookEvents = ['PreToolUse', 'PreCompact'];

  protected createPlan(context: BenchmarkPlannerContext): BenchmarkPlan {
    return {
      summary: '检测到即将发生上下文抖动，当前大读取很可能被快速压缩丢弃。',
      suggestion: this.defaultSuggestion(context.issue) || '先做搜索或符号定位，再只读取命中片段。',
      prompt: '在继续读取大对象之前，先用更窄的搜索策略缩小范围，避免读入后马上被压缩。',
      shouldBlock: this.shouldBlock(context),
      tags: ['context', 'thrashing', 'read-scope'],
    };
  }
}

class ToolCallChainPlanner extends BasePlanner {
  readonly benchmark = 'toolCallChain';
  protected readonly hookEvents = ['PreToolUse', 'PostToolUse'];

  protected createPlan(context: BenchmarkPlannerContext): BenchmarkPlan {
    return {
      summary: '工具调用链重复或循环，当前策略正在空转。',
      suggestion: this.defaultSuggestion(context.issue) || '停止重复调用同一工具，切换到批处理、收敛搜索或验证步骤。',
      prompt: '不要继续重复相同工具链。请先说明已有结果不足之处，然后换用更高信息增益的下一步。',
      shouldBlock: this.shouldBlock(context),
      tags: ['tools', 'loop', 'efficiency'],
    };
  }
}

class DeadStepPlanner extends BasePlanner {
  readonly benchmark = 'deadStep';
  protected readonly hookEvents = ['PreToolUse', 'PostToolUse'];

  protected createPlan(context: BenchmarkPlannerContext): BenchmarkPlan {
    return {
      summary: '上一工具结果尚未进入后续决策链，存在死步骤风险。',
      suggestion: this.defaultSuggestion(context.issue) || '在继续之前明确上一结果对当前目标的作用。',
      prompt: '先说明上一工具结果如何改变你的判断，再决定下一步。不要让读取或搜索结果悬空。',
      shouldBlock: this.shouldBlock(context),
      tags: ['tools', 'usage', 'decision'],
    };
  }
}

class DuplicateStepPlanner extends BasePlanner {
  readonly benchmark = 'duplicateStep';
  protected readonly hookEvents = ['PreToolUse', 'PostToolUse'];

  protected createPlan(context: BenchmarkPlannerContext): BenchmarkPlan {
    return {
      summary: '检测到重复步骤，当前操作与最近一次同类动作高度重合。',
      suggestion: this.defaultSuggestion(context.issue) || '复用已有结果，或扩大目标范围，而不是重复执行相同步骤。',
      prompt: '不要重复执行同一步。请复用最近结果，或明确指出自上次以来发生了什么变化。',
      shouldBlock: this.shouldBlock(context),
      tags: ['tools', 'duplicate', 'reuse'],
    };
  }
}

class WrapperWorkflowPlanner extends BasePlanner {
  readonly benchmark = 'wrapperWorkflow';
  protected readonly hookEvents = ['SubagentStop', 'PreToolUse'];

  protected createPlan(context: BenchmarkPlannerContext): BenchmarkPlan {
    return {
      summary: '当前 subagent 更像包装层，没有带来实质性增量。',
      suggestion: this.defaultSuggestion(context.issue) || '把简单透传逻辑折叠回主线程，或要求 agent 负责验证与聚合。',
      prompt: '若这个子代理仅在透传输入，请停止继续派生相同模式，并把任务收敛成主线程内的直接工具调用。',
      shouldBlock: this.shouldBlock(context),
      tags: ['workflow', 'agent', 'wrapper'],
    };
  }
}

class ContextCouplingPlanner extends BasePlanner {
  readonly benchmark = 'contextCoupling';
  protected readonly hookEvents = ['SubagentStart', 'SubagentStop', 'PreToolUse'];

  protected createPlan(context: BenchmarkPlannerContext): BenchmarkPlan {
    return {
      summary: '多个执行线程在同一代码邻域来回切换，耦合度过高。',
      suggestion: this.defaultSuggestion(context.issue) || '按文件簇或符号所有权切分任务，先完成局部闭环再切换线程。',
      prompt: '请重新划分线程边界：每个 worker 只负责清晰的文件或符号集合，避免上下文在多个线程间回流。',
      shouldBlock: this.shouldBlock(context),
      tags: ['workflow', 'coupling', 'ownership'],
    };
  }
}

class LongChainPlanner extends BasePlanner {
  readonly benchmark = 'longChain';
  protected readonly hookEvents = ['PreToolUse', 'UserPromptSubmit', 'PreCompact'];

  protected createPlan(context: BenchmarkPlannerContext): BenchmarkPlan {
    return {
      summary: '任务链已过长，需要建立检查点并收敛目标。',
      suggestion: this.defaultSuggestion(context.issue) || '先总结已完成项与未完成项，再只推进一个子问题。',
      prompt: '请先给出检查点：已完成、待完成、下一步唯一目标。没有检查点时不要继续扩展链路。',
      shouldBlock: this.shouldBlock(context),
      tags: ['workflow', 'checkpoint', 'chain-length'],
    };
  }
}

class InconsistentToolInterfacePlanner extends BasePlanner {
  readonly benchmark = 'inconsistentToolInterface';
  protected readonly hookEvents = ['SessionStart', 'PreToolUse', 'UserPromptSubmit'];

  protected createPlan(context: BenchmarkPlannerContext): BenchmarkPlan {
    return {
      summary: '相近工具接口不一致，存在误用风险。',
      suggestion: this.defaultSuggestion(context.issue) || '在切换工具前显式声明参数映射和结果字段，不要凭习惯假定接口一致。',
      prompt: '在继续之前，请明确本次工具的输入字段、输出字段和成功判据，避免把上一工具的接口假设直接迁移过来。',
      shouldBlock: this.shouldBlock(context),
      tags: ['tools', 'interface', 'schema'],
    };
  }
}

class WeakToolPlanner extends BasePlanner {
  readonly benchmark = 'weakTool';
  protected readonly hookEvents = ['PreToolUse', 'SessionStart', 'UserPromptSubmit'];

  protected createPlan(context: BenchmarkPlannerContext): BenchmarkPlan {
    return {
      summary: '当前任务存在更适配的工具选择，正在走弱工具路径。',
      suggestion: this.defaultSuggestion(context.issue) || '优先使用更强的搜索、AST 或结构化工具，而不是手工遍历。',
      prompt: '请优先选择信息密度更高、结构化程度更强的工具，不要继续依赖低效替代路径。',
      shouldBlock: this.shouldBlock(context),
      tags: ['tools', 'selection', 'capability'],
    };
  }
}

export function createDefaultPlannerRegistry(): Map<BenchmarkId, BenchmarkPlanner> {
  const planners: BenchmarkPlanner[] = [
    new GhostContextPlanner(),
    new OversizedRulesPlanner(),
    new ContextThrashingPlanner(),
    new ToolCallChainPlanner(),
    new DeadStepPlanner(),
    new DuplicateStepPlanner(),
    new WrapperWorkflowPlanner(),
    new ContextCouplingPlanner(),
    new LongChainPlanner(),
    new InconsistentToolInterfacePlanner(),
    new WeakToolPlanner(),
  ];

  return new Map(planners.map((planner) => [planner.benchmark, planner]));
}
