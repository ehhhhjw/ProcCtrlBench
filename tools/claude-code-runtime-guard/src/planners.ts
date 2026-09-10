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
      summary: 'Detected a large unconsumed payload in the context; compress it before continuing.',
      suggestion: this.defaultSuggestion(context.issue) || 'Keep only the conclusions directly related to the current target file and target symbol, and remove the original bulk content.',
      prompt: 'First summarize the conclusions from the previous large payload that are directly relevant to the current goal, keep only the necessary facts, then decide on the next tool call.',
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
      summary: 'The rule block is too large and is squeezing out effective execution context.',
      suggestion: this.defaultSuggestion(context.issue) || 'Reduce the long rules to a minimal working set, and push the details into an external document or reference them on demand.',
      prompt: 'Reduce the current rules to the minimal set required to solve this subproblem; do not repeatedly inject long static instructions.',
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
      summary: 'Context thrashing is imminent; the current large read is likely to be compacted away almost immediately.',
      suggestion: this.defaultSuggestion(context.issue) || 'Search or locate the symbol first, then read only the matching fragment.',
      prompt: 'Before reading a large object, narrow the scope with a tighter search strategy so that it is not compacted right after being read.',
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
      summary: 'The tool call chain is repeating or looping; the current strategy is spinning in place.',
      suggestion: this.defaultSuggestion(context.issue) || 'Stop calling the same tool repeatedly; switch to batching, a narrowed search, or a verification step.',
      prompt: 'Do not keep repeating the same tool chain. First state what is missing from the results you already have, then switch to a next step with higher information gain.',
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
      summary: 'The previous tool result has not entered the downstream decision chain; there is a dead step risk.',
      suggestion: this.defaultSuggestion(context.issue) || 'Before continuing, state how the previous result bears on the current goal.',
      prompt: 'First explain how the previous tool result changed your judgement, then decide the next step. Do not leave read or search results dangling.',
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
      summary: 'Detected a duplicate step; the current operation overlaps heavily with the most recent action of the same kind.',
      suggestion: this.defaultSuggestion(context.issue) || 'Reuse the existing result or widen the target scope, instead of executing the same step again.',
      prompt: 'Do not execute the same step again. Reuse the most recent result, or state explicitly what has changed since last time.',
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
      summary: 'The current subagent behaves more like a wrapper layer and adds no substantive value.',
      suggestion: this.defaultSuggestion(context.issue) || 'Fold simple pass-through logic back into the main thread, or make the agent responsible for validation and aggregation.',
      prompt: 'If this subagent only passes its input through, stop spawning the same pattern and converge the task into a direct tool call in the main thread.',
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
      summary: 'Multiple execution threads keep switching back and forth within the same code neighborhood; coupling is too high.',
      suggestion: this.defaultSuggestion(context.issue) || 'Split the task by file cluster or symbol ownership, and close one local loop before switching threads.',
      prompt: 'Redraw the thread boundaries: each worker should own a clearly defined set of files or symbols, so that context does not flow back and forth between threads.',
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
      summary: 'The task chain is already too long; establish a checkpoint and converge the goal.',
      suggestion: this.defaultSuggestion(context.issue) || 'Summarize what is done and what is outstanding first, then advance only one subproblem.',
      prompt: 'Provide a checkpoint first: what is done, what is pending, and the single goal of the next step. Do not extend the chain further without a checkpoint.',
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
      summary: 'Similar tools expose inconsistent interfaces, creating a risk of misuse.',
      suggestion: this.defaultSuggestion(context.issue) || 'Declare the parameter mapping and result fields explicitly before switching tools; do not assume the interfaces match out of habit.',
      prompt: 'Before continuing, state the input fields, output fields, and success criteria of this tool, so that interface assumptions from the previous tool are not carried over.',
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
      summary: 'A better-suited tool exists for the current task; the present path relies on a weak tool.',
      suggestion: this.defaultSuggestion(context.issue) || 'Prefer stronger search, AST, or structured tools over manual traversal.',
      prompt: 'Prefer tools with higher information density and stronger structure; do not keep relying on an inefficient substitute path.',
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
