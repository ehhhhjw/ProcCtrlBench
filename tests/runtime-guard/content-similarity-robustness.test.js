const test = require('node:test');
const assert = require('node:assert/strict');

const { ContentSimilarityAnalyzer } = require('../../dist/src/analyzers/ContentSimilarityAnalyzer.js');

test('ContentSimilarityAnalyzer uses a bounded path for large texts', () => {
  const largeA = `alpha beta gamma ${'delta '.repeat(6000)}`;
  const largeB = `alpha beta gamma ${'delta '.repeat(5900)} epsilon`;
  const score = ContentSimilarityAnalyzer.calculateSimilarity(largeA, largeB);

  assert.ok(score > 0.5);
  assert.ok(score <= 1);
});
