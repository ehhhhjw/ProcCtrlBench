import { BaseEvaluator } from './BaseEvaluator';
import { SessionData } from '../../ClaudeCodeStructure/src/types';
import { EvaluationConfig, EvaluationResult, DetectionIssue, Severity } from '../types/evaluation.types';
import { InterfaceConsistencyDetector } from '../detectors/InterfaceConsistencyDetector';
import { WeakToolDetector } from '../detectors/WeakToolDetector';

/**
 * Tool ecosystem consistency evaluator
 */
export class ToolEcosystemEvaluator extends BaseEvaluator {
  readonly name = 'ToolEcosystemEvaluator';
  readonly description = 'Evaluates tool ecosystem consistency, covering interface consistency and tool discoverability';

  async evaluate(): Promise<EvaluationResult> {
    const allIssues: DetectionIssue[] = [];

    // Run the Interface Consistency detector
    const interfaceConsistencyDetector = new InterfaceConsistencyDetector(this.sessionData, this.config);
    const interfaceIssues = await interfaceConsistencyDetector.detect();
    allIssues.push(...interfaceIssues);

    // Run the Weak Tool detector
    const weakToolDetector = new WeakToolDetector(this.sessionData, this.config);
    const weakToolIssues = await weakToolDetector.detect();
    allIssues.push(...weakToolIssues);

    // Count issues
    const issueStats = this.calculateIssueStats(allIssues);

    // Build the details payload
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
   * Builds the details payload
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
