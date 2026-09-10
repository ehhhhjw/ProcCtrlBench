import { BaseEvaluator } from './BaseEvaluator';
import { SessionData } from '../../ClaudeCodeStructure/src/types';
import { EvaluationConfig, EvaluationResult, DetectionIssue, Severity } from '../types/evaluation.types';
import { GhostContextDetector } from '../detectors/GhostContextDetector';
import { ThrashingDetector } from '../detectors/ThrashingDetector';
import { OversizedRulesDetector } from '../detectors/OversizedRulesDetector';

/**
 * Context management evaluator
 */
export class ContextManagementEvaluator extends BaseEvaluator {
  readonly name = 'ContextManagementEvaluator';
  readonly description = 'Evaluates context management capability, covering ghost context, rule bloat and context thrashing';

  async evaluate(): Promise<EvaluationResult> {
    const allIssues: DetectionIssue[] = [];

    // Run the Ghost Context detector
    const ghostContextDetector = new GhostContextDetector(this.sessionData, this.config);
    const ghostContextIssues = await ghostContextDetector.detect();
    allIssues.push(...ghostContextIssues);

    // Run the Thrashing detector
    const thrashingDetector = new ThrashingDetector(this.sessionData, this.config);
    const thrashingIssues = await thrashingDetector.detect();
    allIssues.push(...thrashingIssues);

    // Run the Oversized Rules detector
    const oversizedRulesDetector = new OversizedRulesDetector(this.sessionData, this.config);
    const oversizedRulesIssues = await oversizedRulesDetector.detect();
    allIssues.push(...oversizedRulesIssues);

    // Count issues
    const issueStats = this.calculateIssueStats(allIssues);

    // Build the details payload
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
   * Builds the details payload
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
