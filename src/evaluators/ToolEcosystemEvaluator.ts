import { BaseEvaluator } from './BaseEvaluator';
import { SessionData } from '../../ClaudeCodeStructure/src/types';
import { EvaluationConfig, EvaluationResult, DetectionIssue, Severity } from '../types/evaluation.types';
import { InterfaceConsistencyDetector } from '../detectors/InterfaceConsistencyDetector';
import { WeakToolDetector } from '../detectors/WeakToolDetector';

/**
 * 工具生态一致性评估器
 */
export class ToolEcosystemEvaluator extends BaseEvaluator {
  readonly name = 'ToolEcosystemEvaluator';
  readonly description = '评估工具生态一致性，包括接口一致性和工具可发现性';

  async evaluate(): Promise<EvaluationResult> {
    const allIssues: DetectionIssue[] = [];

    // 运行Interface Consistency检测器
    const interfaceConsistencyDetector = new InterfaceConsistencyDetector(this.sessionData, this.config);
    const interfaceIssues = await interfaceConsistencyDetector.detect();
    allIssues.push(...interfaceIssues);

    // 运行Weak Tool检测器
    const weakToolDetector = new WeakToolDetector(this.sessionData, this.config);
    const weakToolIssues = await weakToolDetector.detect();
    allIssues.push(...weakToolIssues);

    // 统计问题
    const issueStats = this.calculateIssueStats(allIssues);

    // 构建详细信息
    const details = this.buildDetails(allIssues);

    return {
      dimension: 'toolEcosystemConsistency',
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
    const interfaceIssues = issues.filter(i => i.metric === 'inconsistentToolInterface');
    const weakToolIssues = issues.filter(i => i.metric === 'weakTool');

    return {
      inconsistentToolInterface: {
        warnings: interfaceIssues.filter(i => i.severity === Severity.Warning).length,
        errors: interfaceIssues.filter(i => i.severity === Severity.Error).length,
      },
      weakTool: {
        warnings: weakToolIssues.filter(i => i.severity === Severity.Warning).length,
        errors: weakToolIssues.filter(i => i.severity === Severity.Error).length,
      },
    };
  }
}
