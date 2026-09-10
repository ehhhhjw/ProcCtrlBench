const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  applyCalibrationProfileFromFile,
} = require('../../dist/src/config/calibration-loader.js');
const {
  DEFAULT_EVALUATION_CONFIG,
} = require('../../dist/src/config/evaluation.config.js');
const {
  brierScore,
  expectedCalibrationError,
  reliabilityDiagram,
} = require('../../dist/src/benchmark/Stats.js');

test('applyCalibrationProfileFromFile overrides priors and detector baselines', () => {
  const profilePath = path.join(os.tmpdir(), `calibration-profile-${Date.now()}.json`);
  fs.writeFileSync(
    profilePath,
    JSON.stringify({
      profileName: 'learned-v2',
      source: 'unit-test',
      riskModel: {
        metricPriors: {
          weakTool: 0.61,
        },
        calibrationBucketCount: 5,
      },
      detectorCalibration: {
        baselineScores: {
          weakTool: 0.58,
        },
      },
    }),
    'utf-8'
  );

  const config = applyCalibrationProfileFromFile(DEFAULT_EVALUATION_CONFIG, profilePath);
  assert.equal(config.detectorCalibration.profileName, 'learned-v2');
  assert.equal(config.detectorCalibration.calibrationSource, 'unit-test');
  assert.equal(config.riskModel.metricPriors.weakTool, 0.61);
  assert.equal(config.detectorCalibration.baselineScores.weakTool, 0.58);
  assert.equal(config.riskModel.calibrationBucketCount, 5);
});

test('calibration stats compute reliability buckets and scalar metrics', () => {
  const points = [
    { predicted: 0.1, observed: 0 },
    { predicted: 0.2, observed: 0 },
    { predicted: 0.7, observed: 1 },
    { predicted: 0.9, observed: 1 },
  ];

  const buckets = reliabilityDiagram(points, 4);
  assert.equal(buckets.length, 4);
  assert.equal(buckets[0].sampleCount, 2);
  assert.equal(buckets[1].sampleCount, 0);
  assert.equal(buckets[2].sampleCount, 1);
  assert.equal(buckets[3].sampleCount, 1);
  assert.ok(expectedCalibrationError(points, 4) >= 0);
  assert.ok(brierScore(points) >= 0);
});
