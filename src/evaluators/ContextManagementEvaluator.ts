import { BaseEvaluator } from './BaseEvaluator';
import { SessionData } from '../../ClaudeCodeStructure/src/types';
import { EvaluationConfig, EvaluationResult, DetectionIssue, Severity } from '../types/evaluation.types';
import { GhostContextDetector } from '../detectors/GhostContextDetector';
import { ThrashingDetector } from '../detectors/ThrashingDetector';
import { OversizedRulesDetector } from '../detectors/OversizedRulesDetector';

/**
 * 上下文管理评估器
 */
export class ContextManagementEvaluator extends BaseEvaluator {
  readonly name = 'ContextManagementEvaluator';
  readonly description = '评估上下文管理能力，包括幽灵上下文、规则膨胀和上下文抖动';

  async evaluate(): Promise<EvaluationResult> {
    const allIssues: DetectionIssue[] = [];

    // 运行Ghost Context检测器
    const ghostContextDetector = new GhostContextDetector(this.sessionData, this.config);
    const ghostContextIssues = await ghostContextDetector.detect();
    allIssues.push(...ghostContextIssues);

    // 运行Thrashing检测器
    const thrashingDetector = new ThrashingDetector(this.sessionData, this.config);
    const thrashingIssues = await thrashingDetector.detect();
    allIssues.push(...thrashingIssues);

    // 运行Oversized Rules检测器
    const oversizedRulesDetector = new OversizedRulesDetector(this.sessionData, this.config);
    const oversizedRulesIssues = await oversizedRulesDetector.detect();
    allIssues.push(...oversizedRulesIssues);

    // 统计问题
    const issueStats = this.calculateIssueStats(allIssues);

    // 构建详细信息
    const details = this.buildDetails(allIssues);

    return {
      dimension: 'contextManagement',
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
    const ghostContextIssues = issues.filter(i => i.metric === 'ghostContext');
    const oversizedRulesIssues = issues.filter(i => i.metric === 'oversizedRules');
    const thrashingIssues = issues.filter(i => i.metric === 'contextThrashing');

    return {
      ghostContext: {
        warnings: ghostContextIssues.filter(i => i.severity === Severity.Warning).length,
        errors: ghostContextIssues.filter(i => i.severity === Severity.Error).length,
      },
      oversizedRules: {
        warnings: oversizedRulesIssues.filter(i => i.severity === Severity.Warning).length,
        errors: oversizedRulesIssues.filter(i => i.severity === Severity.Error).length,
      },
      thrashing: {
        warnings: thrashingIssues.filter(i => i.severity === Severity.Warning).length,
        errors: thrashingIssues.filter(i => i.severity === Severity.Error).length,
      },
    };
  }
}
