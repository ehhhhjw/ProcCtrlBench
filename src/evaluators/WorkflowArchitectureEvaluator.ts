import { BaseEvaluator } from './BaseEvaluator';
import { SessionData } from '../../ClaudeCodeStructure/src/types';
import { EvaluationConfig, EvaluationResult, DetectionIssue, Severity } from '../types/evaluation.types';
import { LongChainDetector } from '../detectors/LongChainDetector';
import { WrapperDetector } from '../detectors/WrapperDetector';
import { CouplingDetector } from '../detectors/CouplingDetector';

/**
 * 工作流架构评估器
 */
export class WorkflowArchitectureEvaluator extends BaseEvaluator {
  readonly name = 'WorkflowArchitectureEvaluator';
  readonly description = '评估工作流组织能力，包括包装工作流、上下文耦合和执行链长度';

  async evaluate(): Promise<EvaluationResult> {
    const allIssues: DetectionIssue[] = [];

    // 运行长链检测器
    const longChainDetector = new LongChainDetector(this.sessionData, this.config);
    const longChainIssues = await longChainDetector.detect();
    allIssues.push(...longChainIssues);

    // 运行包装检测器
    const wrapperDetector = new WrapperDetector(this.sessionData, this.config);
    const wrapperIssues = await wrapperDetector.detect();
    allIssues.push(...wrapperIssues);

    // 运行耦合检测器
    const couplingDetector = new CouplingDetector(this.sessionData, this.config);
    const couplingIssues = await couplingDetector.detect();
    allIssues.push(...couplingIssues);

    // 统计问题
    const issueStats = this.calculateIssueStats(allIssues);

    // 构建详细信息
    const details = this.buildDetails(allIssues);

    return {
      dimension: 'workflowArchitecture',
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
    const wrapperIssues = issues.filter(i => i.metric === 'wrapperWorkflow');
    const couplingIssues = issues.filter(i => i.metric === 'contextCoupling');
    const longChainIssues = issues.filter(i => i.metric === 'longChain');

    return {
      wrapperWorkflow: {
        warnings: wrapperIssues.filter(i => i.severity === Severity.Warning).length,
        errors: wrapperIssues.filter(i => i.severity === Severity.Error).length,
      },
      contextCoupling: {
        warnings: couplingIssues.filter(i => i.severity === Severity.Warning).length,
        errors: couplingIssues.filter(i => i.severity === Severity.Error).length,
      },
      longChain: {
        warnings: longChainIssues.filter(i => i.severity === Severity.Warning).length,
        errors: longChainIssues.filter(i => i.severity === Severity.Error).length,
      },
    };
  }
}
