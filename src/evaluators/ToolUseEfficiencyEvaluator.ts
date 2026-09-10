import { BaseEvaluator } from './BaseEvaluator';
import { SessionData } from '../../ClaudeCodeStructure/src/types';
import { EvaluationConfig, EvaluationResult, DetectionIssue, Severity } from '../types/evaluation.types';
import { ToolChainDetector } from '../detectors/ToolChainDetector';
import { DuplicateStepDetector } from '../detectors/DuplicateStepDetector';
import { DeadStepDetector } from '../detectors/DeadStepDetector';

/**
 * 工具使用效率评估器
 */
export class ToolUseEfficiencyEvaluator extends BaseEvaluator {
  readonly name = 'ToolUseEfficiencyEvaluator';
  readonly description = '评估工具使用的效率，包括工具调用链、死步骤和重复步骤';

  async evaluate(): Promise<EvaluationResult> {
    const allIssues: DetectionIssue[] = [];

    // 运行各个检测器
    const toolChainDetector = new ToolChainDetector(this.sessionData, this.config);
    const toolChainIssues = await toolChainDetector.detect();
    allIssues.push(...toolChainIssues);

    const duplicateStepDetector = new DuplicateStepDetector(this.sessionData, this.config);
    const duplicateStepIssues = await duplicateStepDetector.detect();
    allIssues.push(...duplicateStepIssues);

    const deadStepDetector = new DeadStepDetector(this.sessionData, this.config);
    const deadStepIssues = await deadStepDetector.detect();
    allIssues.push(...deadStepIssues);

    // 统计问题
    const issueStats = this.calculateIssueStats(allIssues);

    // 构建详细信息
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
   * 构建详细信息
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
