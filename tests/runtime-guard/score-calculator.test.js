const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ScoreCalculator,
} = require('../../dist/src/scoring/ScoreCalculator.js');
const {
  DEFAULT_EVALUATION_CONFIG,
} = require('../../dist/src/config/evaluation.config.js');
const {
  Severity,
} = require('../../dist/src/types/evaluation.types.js');

test('ScoreCalculator emits findings, risk summary, control preservation and execution guidance', () => {
  const calculator = new ScoreCalculator(DEFAULT_EVALUATION_CONFIG);
  const report = calculator.calculateReport(
    'risk-run',
    {
      contextManagement: {
        dimension: 'contextManagement',
        warnings: 1,
        errors: 0,
        details: {
          ghostContext: { warnings: 1, errors: 0 },
          oversizedRules: { warnings: 0, errors: 0 },
          thrashing: { warnings: 0, errors: 0 },
        },
        issues: [
          {
            metric: 'ghostContext',
            severity: Severity.Warning,
            message: 'original content persists after summarization',
            deduction: 1.2,
            suggestion: 'Compress the original content and keep only a structured summary',
            evidence: {
              type: 'strong',
              details: {
                wastedTokens: 980,
                dwellSteps: 6,
              },
            },
          },
        ],
      },
      toolUseEfficiency: {
        dimension: 'toolUseEfficiency',
        warnings: 0,
        errors: 1,
        details: {
          toolCallChain: { warnings: 0, errors: 0 },
          deadStep: { warnings: 0, errors: 1 },
          duplicateStep: { warnings: 0, errors: 0 },
        },
        issues: [
          {
            metric: 'deadStep',
            severity: Severity.Error,
            message: 'execution result never feeds the downstream decision chain',
            deduction: 2.1,
            suggestion: 'Explicitly consume this result in the next step, or remove the step',
            evidence: {
              type: 'medium',
              details: {
                failedChecks: 4,
                downstreamRefs: 0,
              },
            },
          },
        ],
      },
      workflowArchitecture: {
        dimension: 'workflowArchitecture',
        warnings: 1,
        errors: 0,
        details: {
          wrapperWorkflow: { warnings: 0, errors: 0 },
          contextCoupling: { warnings: 0, errors: 0 },
          longChain: { warnings: 1, errors: 0 },
        },
        issues: [
          {
            metric: 'longChain',
            severity: Severity.Warning,
            message: 'chain too long and missing checkpoints',
            deduction: 1.5,
            suggestion: 'Split the work into subtasks and add a checkpoint',
            evidence: {
              type: 'strong',
              details: {
                effectiveLength: 22,
              },
            },
          },
        ],
      },
      toolEcosystemConsistency: {
        dimension: 'toolEcosystemConsistency',
        warnings: 0,
        errors: 0,
        details: {
          inconsistentToolInterface: { warnings: 0, errors: 0 },
          weakTool: { warnings: 0, errors: 0 },
        },
        issues: [],
      },
      taskOutcome: {
        dimension: 'taskOutcome',
        warnings: 0,
        errors: 0,
        issues: [],
        details: {
          taskCompletionRate: 0.7,
          outputExecutability: 0.75,
          postModificationVerificationRate: 0.5,
        },
      },
    },
    {
      enabled: true,
      analyzedSteps: 12,
      averageChainLength: 4,
      maxChainLength: 10,
      averageContextTokensBefore: 2000,
      maxContextTokensBefore: 6000,
    },
    {
      totalMessages: 18,
      totalToolUses: 9,
      totalAgents: 1,
      totalBranches: 1,
      userMessages: 3,
      assistantMessages: 8,
      verificationAttempts: 2,
      successfulVerifications: 1,
      failedToolCalls: 1,
      successfulToolCalls: 8,
      checkpointSignals: 2,
      handoffSignals: 1,
    }
  );

  assert.equal(report.findings.length, 3);
  assert.equal(report.risk.findingCount, 3);
  assert.ok(report.risk.overallRisk > 0);
  assert.ok(report.risk.dimensions.toolUseEfficiency.maxPosteriorRisk > 0);
  assert.ok(report.risk.calibration.expectedCalibrationError >= 0);
  assert.ok(report.risk.calibration.brierScore >= 0);
  assert.equal(report.risk.calibration.sampleCount, 3);
  assert.ok(report.controlPreservation.score >= 0);
  assert.ok(report.controlPreservation.score <= 1);
  assert.ok(['strong', 'moderate', 'fragile'].includes(report.controlPreservation.level));
  assert.ok(report.executionGuidance.autonomyLevel >= 0);
  assert.ok(report.executionGuidance.autonomyLevel <= 1);
  assert.ok(report.executionGuidance.recommendedActions.length >= 1);
  assert.ok(report.findings.some(finding => finding.metric === 'deadStep' && finding.posteriorRisk >= 0.5));
  assert.ok(report.diagnostics.every((issue) => typeof issue.detectorScore === 'number' || issue.detectorScore === undefined));
});
