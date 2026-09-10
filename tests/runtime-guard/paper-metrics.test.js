const test = require('node:test');
const assert = require('node:assert/strict');

const {
  auroc,
  averagePrecision,
  bootstrapRankStability,
  cohensKappa,
  compareCalibration,
  computeAgreementStats,
  computeCorrelationMatrix,
  computeDetectionMetrics,
  defectFailureAssociation,
} = require('../../dist/src/benchmark/PaperMetrics.js');
const { createSeededRng } = require('../../dist/src/benchmark/Stats.js');

const EPS = 1e-9;

test('averagePrecision and auroc reach 1 under perfect separation', () => {
  const labels = [true, true, false, false];
  const scores = [0.9, 0.8, 0.3, 0.2];
  assert.ok(Math.abs(averagePrecision(labels, scores) - 1) < EPS);
  assert.ok(Math.abs(auroc(labels, scores) - 1) < EPS);
});

test('auroc matches the Mann-Whitney closed form on interleaved scores', () => {
  // Positive scores rank 4 and 2 -> (6 - 2*3/2) / (2*2) = 0.75
  const value = auroc([true, false, true, false], [0.9, 0.8, 0.7, 0.6]);
  assert.ok(Math.abs(value - 0.75) < EPS, `expected 0.75, got ${value}`);
});

test('auroc is 0 under perfect inversion and 0.5 under full ties', () => {
  assert.ok(Math.abs(auroc([false, false, true, true], [0.9, 0.8, 0.3, 0.2])) < EPS);
  assert.ok(Math.abs(auroc([true, false, true, false], [0.5, 0.5, 0.5, 0.5]) - 0.5) < EPS);
});

test('averagePrecision matches the stepwise PR definition', () => {
  // Descending order is [pos, neg, pos, neg]: precision 1/1 and 2/3
  const expected = (1 + 2 / 3) / 2;
  const value = averagePrecision([true, false, true, false], [0.9, 0.8, 0.7, 0.6]);
  assert.ok(Math.abs(value - expected) < EPS, `expected ${expected}, got ${value}`);
});

test('auroc and averagePrecision degrade to 0 when a class is missing', () => {
  assert.equal(auroc([true, true], [0.9, 0.8]), 0);
  assert.equal(averagePrecision([false, false], [0.9, 0.8]), 0);
});

test('cohensKappa is 0 at chance agreement and 1 at full agreement', () => {
  assert.ok(Math.abs(cohensKappa([true, true, false, false], [true, false, true, false])) < EPS);
  assert.ok(Math.abs(cohensKappa([true, false, true, false], [true, false, true, false]) - 1) < EPS);
  // Both raters label every item false: no variation but full agreement, defined as 1.
  assert.equal(cohensKappa([false, false], [false, false]), 1);
});

test('computeDetectionMetrics derives precision, recall, f1 and trigger rate', () => {
  const metrics = computeDetectionMetrics([
    { label: true, score: 0.9, triggered: true },
    { label: true, score: 0.8, triggered: true },
    { label: false, score: 0.7, triggered: true },
    { label: true, score: 0.2, triggered: false },
    { label: false, score: 0.1, triggered: false },
  ]);

  assert.equal(metrics.truePositives, 2);
  assert.equal(metrics.falsePositives, 1);
  assert.equal(metrics.falseNegatives, 1);
  assert.equal(metrics.trueNegatives, 1);
  assert.equal(metrics.positives, 3);
  assert.ok(Math.abs(metrics.precision - 2 / 3) < EPS);
  assert.ok(Math.abs(metrics.recall - 2 / 3) < EPS);
  assert.ok(Math.abs(metrics.f1 - 2 / 3) < EPS);
  assert.ok(Math.abs(metrics.triggerRate - 3 / 5) < EPS);
});

test('computeDetectionMetrics returns a zeroed row for an empty sample', () => {
  const metrics = computeDetectionMetrics([]);
  assert.equal(metrics.support, 0);
  assert.equal(metrics.f1, 0);
  assert.equal(metrics.auroc, 0);
});

test('computeAgreementStats reports raw agreement, exemption and adjudication rates', () => {
  const stats = computeAgreementStats([
    { annotatorA: true, annotatorB: true },
    { annotatorA: false, annotatorB: false, exempt: true },
    { annotatorA: true, annotatorB: false, adjudicated: true },
    { annotatorA: false, annotatorB: false },
  ]);

  assert.equal(stats.support, 4);
  assert.ok(Math.abs(stats.rawAgreement - 0.75) < EPS);
  assert.ok(Math.abs(stats.exemptionRate - 0.25) < EPS);
  assert.ok(Math.abs(stats.adjudicationRate - 0.25) < EPS);
});

test('compareCalibration favours posterior risk over hard thresholding', () => {
  // Every trigger is scored as 1, but only half are true -> the hard branch is severely overestimated.
  const samples = [
    { label: true, triggered: true, posteriorRisk: 0.5 },
    { label: false, triggered: true, posteriorRisk: 0.5 },
    { label: true, triggered: true, posteriorRisk: 0.5 },
    { label: false, triggered: true, posteriorRisk: 0.5 },
  ];
  const comparison = compareCalibration(samples);

  assert.ok(Math.abs(comparison.hardEce - 0.5) < EPS, `hardEce=${comparison.hardEce}`);
  assert.ok(Math.abs(comparison.bayesEce) < EPS, `bayesEce=${comparison.bayesEce}`);
  assert.ok(comparison.improvement > 0);
  assert.equal(comparison.support, 4);
});

test('computeCorrelationMatrix has a unit diagonal and detects inversion', () => {
  const matrix = computeCorrelationMatrix({ a: [1, 2, 3, 4], b: [4, 3, 2, 1] });
  assert.deepEqual(matrix.keys, ['a', 'b']);
  assert.equal(matrix.matrix[0][0], 1);
  assert.equal(matrix.matrix[1][1], 1);
  assert.ok(Math.abs(matrix.matrix[0][1] + 1) < EPS);
  assert.equal(matrix.support, 4);
});

test('computeCorrelationMatrix rejects misaligned series', () => {
  assert.throws(
    () => computeCorrelationMatrix({ a: [1, 2, 3], b: [1, 2] }),
    /equal-length aligned series/
  );
});

test('defectFailureAssociation is positive when triggers track failures', () => {
  const association = defectFailureAssociation(
    [true, true, false, false],
    [true, true, false, false]
  );
  assert.ok(Math.abs(association.correlation - 1) < EPS);
  assert.equal(association.support, 4);
});

test('bootstrapRankStability ranks a dominant system first and is seed-reproducible', () => {
  const inputs = [
    { system: 'strong', scores: [0.9, 0.92, 0.91, 0.9] },
    { system: 'middle', scores: [0.7, 0.71, 0.69, 0.7] },
    { system: 'weak', scores: [0.4, 0.41, 0.39, 0.4] },
  ];

  const first = bootstrapRankStability(inputs, { replicates: 200, rng: createSeededRng(7) });
  const second = bootstrapRankStability(inputs, { replicates: 200, rng: createSeededRng(7) });
  assert.deepEqual(first, second, 'same seed must produce identical output');

  const strong = first.find((row) => row.system === 'strong');
  const weak = first.find((row) => row.system === 'weak');
  assert.equal(strong.top1Frequency, 1);
  assert.equal(strong.meanRank, 1);
  assert.equal(weak.top1Frequency, 0);
  assert.equal(weak.meanRank, 3);
});

test('bootstrapRankStability respects stratum boundaries when resampling', () => {
  const inputs = [
    {
      system: 'only-system',
      scores: [1, 1, 0, 0],
      strata: ['android', 'android', 'terminal', 'terminal'],
    },
  ];
  const rows = bootstrapRankStability(inputs, { replicates: 50, rng: createSeededRng(11) });
  // Resample two items per stratum; the mean is always (1 + 0) / 2.
  assert.ok(Math.abs(rows[0].meanScore - 0.5) < EPS, `meanScore=${rows[0].meanScore}`);
});
