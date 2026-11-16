import { SessionData } from '../../ClaudeCodeStructure/src/types';
import {
  IEvaluator,
  EvaluationResult,
  EvaluationConfig,
  DetectionIssue,
  Severity
} from '../types/evaluation.types';

/**
 * Base class for evaluators
 */
export abstract class BaseEvaluator implements IEvaluator {
  protected sessionData: SessionData;
  protected config: EvaluationConfig;

  constructor(sessionData: SessionData, config: EvaluationConfig) {
    this.sessionData = sessionData;
    this.config = config;
  }

  abstract get name(): string;
  abstract get description(): string;
  abstract evaluate(): Promise<EvaluationResult>;

  /**
   * Counts issues by severity
   */
  protected calculateIssueStats(issues: DetectionIssue[]): {
    warnings: number;
    errors: number;
  } {
    let warnings = 0;
    let errors = 0;

    for (const issue of issues) {
      if (issue.severity === Severity.Warning) {
        warnings++;
      } else if (issue.severity === Severity.Error) {
        errors++;
      }
    }

    return {
      warnings,
      errors,
    };
  }

  /**
   * Creates an issue object
   */
  protected createIssue(
    metric: string,
    severity: Severity,
    message: string,
    deduction: number,
    location?: DetectionIssue['location'],
    suggestion?: string,
    evidence?: DetectionIssue['evidence']
  ): DetectionIssue {
    return {
      metric,
      severity,
      message,
      deduction,
      location,
      suggestion,
      evidence,
    };
  }

}
