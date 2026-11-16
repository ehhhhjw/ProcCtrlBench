'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_ETA,
  DEFAULT_FRAGILE_PB_THRESHOLD,
  DEFAULT_ERROR_BAND_THRESHOLD,
  DEFAULT_MIN_ERROR_DEFECTS,
  isFragileSuccess,
  computePolicyQuality,
  computeInfraQuality,
} = require('../../dist/src/benchmark/ProcCtrlScorecard.js');

test('paper v8 scoring constants are aligned', () => {
  assert.equal(DEFAULT_ETA, 0.7);
  assert.equal(DEFAULT_FRAGILE_PB_THRESHOLD, 0.65);
  assert.equal(DEFAULT_ERROR_BAND_THRESHOLD, 0.7);
  assert.equal(DEFAULT_MIN_ERROR_DEFECTS, 2);
});

test('fragile success uses PB < 0.65 OR at least two error-band defects', () => {
  const base = {
    success: true,
    cp: 0.9,
    errorFindings: 0,
    defectRisks: {},
  };

  assert.equal(isFragileSuccess({ ...base, pb: 0.6 }), true);
  assert.equal(isFragileSuccess({ ...base, pb: 0.7 }), false);
  assert.equal(
    isFragileSuccess({
      ...base,
      pb: 0.7,
      defectRisks: { ghostContext: 0.75 },
    }),
    false,
    'one error-band defect is not enough'
  );
  assert.equal(
    isFragileSuccess({
      ...base,
      pb: 0.7,
      defectRisks: { ghostContext: 0.75, weakTool: 0.8 },
    }),
    true
  );
  assert.equal(isFragileSuccess({ ...base, success: false, pb: 0.1 }), false);
});

test('policy and infrastructure quality split the 11 defects into 7 + 4', () => {
  const zero = {};
  const all = {
    ghostContext: 1,
    oversizedRules: 1,
    thrashing: 1,
    duplicateStep: 1,
    toolCallChain: 1,
    deadStep: 1,
    longChain: 1,
    wrapperWorkflow: 1,
    contextCoupling: 1,
    inconsistentToolInterface: 1,
    weakTool: 1,
  };
  assert.equal(computePolicyQuality(zero), 1);
  assert.equal(computeInfraQuality(zero), 1);
  assert.equal(computePolicyQuality(all), 0);
  assert.equal(computeInfraQuality(all), 0);
});