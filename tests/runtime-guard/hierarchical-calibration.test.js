'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  fitHierarchicalCalibration,
  calibratedRisk,
  validateCalibrationProfile,
} = require('../../dist/src/benchmark/HierarchicalCalibration.js');

function makeSamples(defect, benchmark, count, split) {
  const samples = [];
  for (let index = 0; index < count; index++) {
    const signal = index / Math.max(1, count - 1);
    samples.push({
      defect,
      benchmark,
      signal: split === 'dev' ? signal : signal * 0.95,
      label: signal > 0.5,
      exempt: false,
    });
  }
  return samples;
}

test('fitHierarchicalCalibration learns a monotone positive beta and floors exempt risk', () => {
  const dev = [];
  const cal = [];
  for (const defect of ['ghostContext', 'duplicateStep', 'wrapperWorkflow', 'weakTool']) {
    const benchmark =
      defect === 'ghostContext'
        ? 'swe-bench-verified'
        : defect === 'duplicateStep'
          ? 'terminal-bench'
          : 'android-bench';
    dev.push(...makeSamples(defect, benchmark, 20, 'dev'));
    cal.push(...makeSamples(defect, benchmark, 20, 'cal'));
  }

  const profile = fitHierarchicalCalibration(dev, cal, {
    iterations: 400,
    empiricalBayesIterations: 1,
  });

  const errors = validateCalibrationProfile(profile);
  assert.deepEqual(errors, []);

  const ghost = profile.defects.ghostContext;
  assert.ok(ghost.beta >= 0, `beta=${ghost.beta}`);
  assert.ok(Number.isFinite(ghost.alpha));

  const low = calibratedRisk(profile, 'ghostContext', 0.0, 'swe-bench-verified');
  const high = calibratedRisk(profile, 'ghostContext', 1.0, 'swe-bench-verified');
  assert.ok(high >= low, `high=${high} low=${low}`);

  const exempt = calibratedRisk(profile, 'ghostContext', 0.9, 'swe-bench-verified', true);
  assert.ok(exempt < 0.02, `exempt risk=${exempt}`);
});