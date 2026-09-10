import { BaseEvaluator } from './BaseEvaluator';
import { SessionData } from '../../ClaudeCodeStructure/src/types';
import { EvaluationConfig, EvaluationResult, DetectionIssue, Severity } from '../types/evaluation.types';
import { LongChainDetector } from '../detectors/LongChainDetector';
import { WrapperDetector } from '../detectors/WrapperDetector';
import { CouplingDetector } from '../detectors/CouplingDetector';

/**
 * Workflow architecture evaluator
 */
export class WorkflowArchitectureEvaluator extends BaseEvaluator {
  readonly name = 'WorkflowArchitectureEvaluator';
  readonly description = 'Evaluates workflow organization capability, covering wrapper workflows, context coupling and execution chain length';

  async evaluate(): Promise<EvaluationResult> {
    const allIssues: DetectionIssue[] = [];

    // Run the long chain detector
    const longChainDetector = new LongChainDetector(this.sessionData, this.config);
    const longChainIssues = await longChainDetector.detect();
    allIssues.push(...longChainIssues);

    // Run the wrapper detector
    const wrapperDetector = new WrapperDetector(this.sessionData, this.config);
    const wrapperIssues = await wrapperDetector.detect();
    allIssues.push(...wrapperIssues);

    // Run the coupling detector
    const couplingDetector = new CouplingDetector(this.sessionData, this.config);
    const couplingIssues = await couplingDetector.detect();
    allIssues.push(...couplingIssues);

    // Count issues
    const issueStats = this.calculateIssueStats(allIssues);

    // Build the details payload
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
   * Builds the details payload
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
