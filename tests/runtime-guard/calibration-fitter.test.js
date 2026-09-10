const test = require('node:test');
const assert = require('node:assert/strict');

const {
  fitCalibrationProfile,
} = require('../../dist/src/benchmark/CalibrationFitter.js');
const {
  DEFAULT_EVALUATION_CONFIG,
} = require('../../dist/src/config/evaluation.config.js');

test('fitCalibrationProfile learns metric priors and baseline scores from report findings', () => {
  const reports = [
    {
      findings: [
        {
          metric: 'deadStep',
          severity: 'error',
          riskSeverity: 'error',
          detectorScore: 0.82,
          posteriorRisk: 0.87,
          normalizedSignal: 0.9,
          evidence: { type: 'strong', details: {} },
        },
        {
          metric: 'deadStep',
          severity: 'warning',
          riskSeverity: 'warning',
          detectorScore: 0.74,
          posteriorRisk: 0.68,
          normalizedSignal: 0.76,
          evidence: { type: 'medium', details: {} },
        },
        {
          metric: 'weakTool',
          severity: 'warning',
          riskSeverity: 'info',
          detectorScore: 0.51,
          posteriorRisk: 0.4,
          normalizedSignal: 0.52,
          evidence: { type: 'weak', details: {} },
        },
      ],
    },
    {
      findings: [
        {
          metric: 'deadStep',
          severity: 'error',
          riskSeverity: 'error',
          detectorScore: 0.79,
          posteriorRisk: 0.84,
          normalizedSignal: 0.88,
          evidence: { type: 'strong', details: {} },
        },
        {
          metric: 'weakTool',
          severity: 'warning',
          riskSeverity: 'warning',
          detectorScore: 0.48,
          posteriorRisk: 0.36,
          normalizedSignal: 0.47,
          evidence: { type: 'weak', details: {} },
        },
      ],
    },
  ];

  const fit = fitCalibrationProfile(reports, DEFAULT_EVALUATION_CONFIG, {
    shrinkage: 2,
    minMetricSamples: 2,
    profileName: 'fitted-test',
    source: 'unit-test',
  });

  assert.equal(fit.profile.profileName, 'fitted-test');
  assert.equal(fit.profile.source, 'unit-test');
  assert.equal(fit.totalFindings, 5);
  assert.ok(fit.metrics.deadStep.support >= 2);
  assert.ok(fit.profile.riskModel.metricPriors.deadStep > DEFAULT_EVALUATION_CONFIG.riskModel.metricPriors.deadStep);
  assert.ok(fit.profile.detectorCalibration.baselineScores.deadStep > DEFAULT_EVALUATION_CONFIG.detectorCalibration.baselineScores.deadStep);
  assert.ok(fit.profile.riskModel.metricPriors.weakTool >= 0);
  assert.equal(fit.profile.metadata.labelMode, 'severity-error');
  assert.equal(typeof fit.globalCalibration.expectedCalibrationError, 'number');
  assert.equal(fit.profile.metadata.metricSampleCounts.deadStep, 3);
});
