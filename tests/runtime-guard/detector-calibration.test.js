const test = require('node:test');
const assert = require('node:assert/strict');

const {
  finalizeDetectorIssue,
  canonicalizeDetectorMetric,
} = require('../../dist/src/detectors/detector-calibration.js');
const {
  DEFAULT_EVALUATION_CONFIG,
} = require('../../dist/src/config/evaluation.config.js');
const {
  Severity,
} = require('../../dist/src/types/evaluation.types.js');

test('finalizeDetectorIssue injects baseline calibration and normalized score', () => {
  const finalized = finalizeDetectorIssue(
    {
      metric: 'contextThrashing',
      severity: Severity.Warning,
      message: 'context thrash',
      deduction: 1,
      evidence: {
        type: 'medium',
        details: {
          payloadSize: 8000,
          windowCapacity: 10000,
          compressionDelay: 2,
          windowUsage: '84%',
          exemptions: ['expected_batch'],
        },
      },
    },
    DEFAULT_EVALUATION_CONFIG
  );

  assert.equal(canonicalizeDetectorMetric(finalized.metric), 'thrashing');
  assert.equal(finalized.baselineRisk, DEFAULT_EVALUATION_CONFIG.riskModel.metricPriors.thrashing);
  assert.equal(finalized.baselineScore, DEFAULT_EVALUATION_CONFIG.detectorCalibration.baselineScores.thrashing);
  assert.ok(finalized.rawSignal > 0);
  assert.ok(finalized.normalizedSignal > 0.5);
  assert.ok(finalized.detectorScore >= finalized.baselineScore);
  assert.deepEqual(finalized.exemptionsApplied, ['expected_batch']);
  assert.equal(finalized.evidence.details.canonicalMetric, 'thrashing');
  assert.equal(finalized.evidence.details.schemaVersion, 'detector-evidence/v1');
  assert.equal(finalized.evidence.details.signalType, 'context-pressure');
  assert.equal(finalized.evidence.details.signalSource, 'message-context');
  assert.equal(finalized.evidence.details.thresholds.windowThreshold, DEFAULT_EVALUATION_CONFIG.thresholds.thrashing.windowThreshold);
  assert.ok(Array.isArray(finalized.evidence.details.decisionPath));
  assert.ok(finalized.evidence.details.decisionPath.length >= 4);
  assert.equal(finalized.evidence.details.nativeDetectorScore, finalized.detectorScore);
  assert.deepEqual(finalized.evidence.details.exemptions, [
    {
      code: 'expected_batch',
      reason: 'expected_batch',
      matched: true,
      source: 'detector',
    },
  ]);
});
