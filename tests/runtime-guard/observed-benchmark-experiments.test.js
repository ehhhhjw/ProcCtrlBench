const test = require('node:test');
const assert = require('node:assert/strict');

const {
  aggregateObservedBenchmarkSummaries,
  computeDefectFailureCorrelations,
  computeFragileSuccessRate,
  computeSweControlSummary,
  reportToObservedTrajectoryRecord,
  resolveOutcomeMetric,
} = require('../../dist/src/benchmark/ObservedBenchmarkExperiments.js');

function buildReport(overrides = {}) {
  return {
    runId: 'run-1',
    timestamp: '2026-04-27T00:00:00.000Z',
    analysis: {
      contextChains: {
        enabled: true,
        analyzedSteps: 12,
        averageChainLength: 6,
        maxChainLength: 9,
        averageContextTokensBefore: 1200,
        maxContextTokensBefore: 2000,
      },
      standardEventStream: {
        enabled: true,
        totalEvents: 30,
        messageEvents: 10,
        toolCallEvents: 10,
        toolResultEvents: 10,
        compressedEvents: 0,
        actorCounts: {},
        eventTypeCounts: {},
      },
    },
    dimensions: {
      taskOutcome: {
        warnings: 0,
        errors: 0,
        details: {
          taskCompletionRate: 0.8,
          outputExecutability: 0.7,
          postModificationVerificationRate: 0.6,
        },
      },
      contextManagement: {
        warnings: 0,
        errors: 0,
        details: {
          ghostContext: { warnings: 1, errors: 0 },
          oversizedRules: { warnings: 0, errors: 0 },
          thrashing: { warnings: 0, errors: 0 },
        },
      },
      toolUseEfficiency: {
        warnings: 1,
        errors: 1,
        details: {
          toolCallChain: { warnings: 0, errors: 0 },
          deadStep: { warnings: 0, errors: 1 },
          duplicateStep: { warnings: 1, errors: 0 },
        },
      },
      workflowArchitecture: {
        warnings: 1,
        errors: 0,
        details: {
          wrapperWorkflow: { warnings: 0, errors: 0 },
          contextCoupling: { warnings: 0, errors: 0 },
          longChain: { warnings: 1, errors: 0 },
        },
      },
      toolEcosystemConsistency: {
        warnings: 0,
        errors: 0,
        details: {
          inconsistentToolInterface: { warnings: 0, errors: 0 },
          weakTool: { warnings: 0, errors: 0 },
        },
      },
    },
    diagnostics: [],
    findings: [],
    risk: {
      model: {
        kind: 'heuristic-bayesian-proxy',
        warningThreshold: 0.55,
        errorThreshold: 0.8,
      },
      calibration: {
        bucketCount: 10,
        sampleCount: 0,
        labelDefinition: 'detectorSeverity=error',
        meanPredictedRisk: 0,
        observedPositiveRate: 0,
        expectedCalibrationError: 0,
        maxCalibrationGap: 0,
        brierScore: 0,
        buckets: [],
      },
      overallRisk: 0.64,
      averagePosteriorRisk: 0.58,
      findingCount: 3,
      warningFindings: 2,
      errorFindings: 1,
      topRiskFindings: [],
      dimensions: {
        contextManagement: {
          warnings: 1,
          errors: 0,
          averageDetectorScore: 0.5,
          averagePosteriorRisk: 0.52,
          maxPosteriorRisk: 0.52,
        },
        toolUseEfficiency: {
          warnings: 1,
          errors: 1,
          averageDetectorScore: 0.7,
          averagePosteriorRisk: 0.71,
          maxPosteriorRisk: 0.84,
        },
        workflowArchitecture: {
          warnings: 1,
          errors: 0,
          averageDetectorScore: 0.6,
          averagePosteriorRisk: 0.61,
          maxPosteriorRisk: 0.61,
        },
        toolEcosystemConsistency: {
          warnings: 0,
          errors: 0,
          averageDetectorScore: 0,
          averagePosteriorRisk: 0,
          maxPosteriorRisk: 0,
        },
      },
    },
    controlPreservation: {
      score: 0.44,
      level: 'fragile',
      metrics: {
        interpretability: 0.41,
        interruptibility: 0.35,
        corrigibility: 0.52,
        reversibility: 0.47,
        handoffAwareness: 0.3,
      },
      evidence: [],
    },
    executionGuidance: {
      autonomyLevel: 0.39,
      recommendedActions: [
        { type: 'verify-before-next-step', reason: 'x', triggeredBy: ['deadStep'] },
        { type: 'create-checkpoint', reason: 'y', triggeredBy: ['longChain'] },
      ],
      rationale: [],
    },
    summary: {
      totalWarnings: 3,
      totalErrors: 1,
      keyIssues: [],
      strengths: [],
    },
    ...overrides,
  };
}

test('reportToObservedTrajectoryRecord flattens benchmark metadata and report metrics', () => {
  const record = reportToObservedTrajectoryRecord(
    {
      source: 'swe-bench',
      benchmark: 'swe-bench-verified',
      taskId: 'astropy__astropy-12907',
      trialId: 'single',
      success: true,
      status: 'resolved',
      tokens: 12345,
      costUsd: 1.23,
      rawPath: '/tmp/example.traj',
    },
    buildReport(),
    {
      variant: 'observed-public-run',
      reportPath: '/tmp/report.json',
    }
  );

  assert.equal(record.outcomeMetric, 'testPassRate');
  assert.equal(record.success, true);
  assert.equal(record.totalWarnings, 3);
  assert.equal(record.totalErrors, 1);
  assert.equal(record.deadStepTriggered, true);
  assert.equal(record.longChainTriggered, true);
  assert.equal(record.reportPath, '/tmp/report.json');
  assert.deepEqual(record.recommendedActions, ['verify-before-next-step', 'create-checkpoint']);
});

test('aggregateObservedBenchmarkSummaries computes outcome and recovery aggregates', () => {
  const rows = aggregateObservedBenchmarkSummaries([
    {
      variant: 'observed-public-run',
      benchmark: 'android-bench',
      outcomeMetric: 'successRate',
      success: true,
      tokens: 10,
      costUsd: 1,
      totalWarnings: 2,
      totalErrors: 0,
      overallRisk: 0.4,
      averagePosteriorRisk: 0.3,
      controlPreservation: 0.6,
      interpretability: 0.7,
      handoffAwareness: 0.5,
      autonomyLevel: 0.55,
      taskCompletionRate: 0.8,
      outputExecutability: 0.7,
      postModificationVerificationRate: 0.6,
      errorFindings: 0,
    },
    {
      variant: 'observed-public-run',
      benchmark: 'android-bench',
      outcomeMetric: 'successRate',
      success: false,
      tokens: 30,
      costUsd: 3,
      totalWarnings: 4,
      totalErrors: 2,
      overallRisk: 0.8,
      averagePosteriorRisk: 0.7,
      controlPreservation: 0.3,
      interpretability: 0.4,
      handoffAwareness: 0.2,
      autonomyLevel: 0.2,
      taskCompletionRate: 0.4,
      outputExecutability: 0.3,
      postModificationVerificationRate: 0.2,
      errorFindings: 2,
    },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].sampleCount, 2);
  assert.equal(rows[0].outcomeRate, 0.5);
  assert.equal(rows[0].recoveryAfterErrorRate, 0);
  assert.equal(rows[0].meanTokens, 20);
  assert.ok(Math.abs(rows[0].meanControlPreservation - 0.45) < 1e-9);
});

test('computeDefectFailureCorrelations and SWE control summary derive paper-like offline metrics', () => {
  const records = [
    {
      variant: 'observed-public-run',
      benchmark: 'swe-bench-verified',
      outcomeMetric: 'testPassRate',
      success: true,
      controlPreservation: 0.4,
      interpretability: 0.5,
      handoffAwareness: 0.2,
      deadStepTriggered: true,
      longChainTriggered: true,
      ghostContextTriggered: false,
      oversizedRulesTriggered: false,
      thrashingTriggered: false,
      duplicateStepTriggered: false,
      toolCallChainTriggered: false,
      wrapperWorkflowTriggered: false,
      contextCouplingTriggered: false,
      inconsistentToolInterfaceTriggered: false,
      weakToolTriggered: false,
    },
    {
      variant: 'observed-public-run',
      benchmark: 'swe-bench-verified',
      outcomeMetric: 'testPassRate',
      success: false,
      controlPreservation: 0.6,
      interpretability: 0.7,
      handoffAwareness: 0.5,
      deadStepTriggered: false,
      longChainTriggered: false,
      ghostContextTriggered: true,
      oversizedRulesTriggered: false,
      thrashingTriggered: false,
      duplicateStepTriggered: false,
      toolCallChainTriggered: false,
      wrapperWorkflowTriggered: false,
      contextCouplingTriggered: false,
      inconsistentToolInterfaceTriggered: false,
      weakToolTriggered: false,
    },
    {
      variant: 'observed-public-run',
      benchmark: 'swe-bench-verified',
      outcomeMetric: 'testPassRate',
      success: true,
      controlPreservation: 0.8,
      interpretability: 0.8,
      handoffAwareness: 0.6,
      deadStepTriggered: false,
      longChainTriggered: false,
      ghostContextTriggered: false,
      oversizedRulesTriggered: false,
      thrashingTriggered: false,
      duplicateStepTriggered: false,
      toolCallChainTriggered: false,
      wrapperWorkflowTriggered: false,
      contextCouplingTriggered: false,
      inconsistentToolInterfaceTriggered: false,
      weakToolTriggered: false,
    },
  ];

  const fragileSuccessRate = computeFragileSuccessRate(records);
  assert.equal(fragileSuccessRate, 0.5);

  const sweSummary = computeSweControlSummary(records);
  assert.equal(sweSummary.length, 1);
  assert.equal(sweSummary[0].fragileSuccessRate, 0.5);
  assert.equal(sweSummary[0].cpMean, 0.6);

  const correlations = computeDefectFailureCorrelations(records, 'swe-bench-verified');
  const deadStep = correlations.find((row) => row.metric === 'deadStep');
  assert.equal(deadStep.triggerCount, 1);
  assert.equal(deadStep.failureRateWhenTriggered, 0);
  assert.equal(resolveOutcomeMetric('android-bench'), 'successRate');
});
