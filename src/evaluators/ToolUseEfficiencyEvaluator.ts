import { BaseEvaluator } from './BaseEvaluator';
import { SessionData } from '../../ClaudeCodeStructure/src/types';
import { EvaluationConfig, EvaluationResult, DetectionIssue, Severity } from '../types/evaluation.types';
import { ToolChainDetector } from '../detectors/ToolChainDetector';
import { DuplicateStepDetector } from '../detectors/DuplicateStepDetector';
import { DeadStepDetector } from '../detectors/DeadStepDetector';

/**
 * Tool use efficiency evaluator
 */
export class ToolUseEfficiencyEvaluator extends BaseEvaluator {
  readonly name = 'ToolUseEfficiencyEvaluator';
  readonly description = 'Evaluates tool use efficiency, covering tool call chains, dead steps and duplicate steps';

  async evaluate(): Promise<EvaluationResult> {
    const allIssues: DetectionIssue[] = [];

    // Run each detector
    const toolChainDetector = new ToolChainDetector(this.sessionData, this.config);
    const toolChainIssues = await toolChainDetector.detect();
    allIssues.push(...toolChainIssues);

    const duplicateStepDetector = new DuplicateStepDetector(this.sessionData, this.config);
    const duplicateStepIssues = await duplicateStepDetector.detect();
    allIssues.push(...duplicateStepIssues);

    const deadStepDetector = new DeadStepDetector(this.sessionData, this.config);
    const deadStepIssues = await deadStepDetector.detect();
    allIssues.push(...deadStepIssues);

    // Count issues
    const issueStats = this.calculateIssueStats(allIssues);

    // Build the details payload
    const details = this.buildDetails(allIssues);

    return {
      dimension: 'toolUseEfficiency',
      warnings: issueStats.warnings,
      errors: issueStats.errors,
      issues: allIssues,
      details,
    };
  }

  /**
   * Builds the details payload
   */
  private buildDetails(issues: DetectionIssue[]): Record<string, any> {
    const toolChainIssues = issues.filter(i => i.metric === 'toolCallChain');
    const deadStepIssues = issues.filter(i => i.metric === 'deadStep');
    const duplicateStepIssues = issues.filter(i => i.metric === 'duplicateStep');

    return {
      toolCallChain: {
        warnings: toolChainIssues.filter(i => i.severity === Severity.Warning).length,
        errors: toolChainIssues.filter(i => i.severity === Severity.Error).length,
      },
      deadStep: {
        warnings: deadStepIssues.filter(i => i.severity === Severity.Warning).length,
        errors: deadStepIssues.filter(i => i.severity === Severity.Error).length,
      },
      duplicateStep: {
        warnings: duplicateStepIssues.filter(i => i.severity === Severity.Warning).length,
        errors: duplicateStepIssues.filter(i => i.severity === Severity.Error).length,
      },
    };
  }
}
