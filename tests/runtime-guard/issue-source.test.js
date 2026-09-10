const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  normalizeGuardConfig,
} = require('../../dist/tools/claude-code-runtime-guard/src/config.js');
const {
  DetectorIssueSource,
} = require('../../dist/tools/claude-code-runtime-guard/src/issue-source.js');

test('detector issue source can analyze a real Claude Code jsonl session', async () => {
  const repoRoot = path.resolve(__dirname, '../..');
  const samplePath = path.join(repoRoot, 'ClaudeCodeStructure/tests/sample.jsonl');
  const config = normalizeGuardConfig({
    runtime: {
      analysisRootDir: repoRoot,
    },
  });

  const source = new DetectorIssueSource();
  const snapshot = await source.analyzeSession(
    {
      transcriptPath: samplePath,
    },
    config
  );

  assert.equal(snapshot.sessionId, 'sample');
  assert.ok(snapshot.lineCount > 0);
  assert.ok(Array.isArray(snapshot.issues));
  assert.ok(Array.isArray(snapshot.detectorErrors));
  assert.ok(snapshot.report);
  assert.equal(typeof snapshot.report.risk.overallRisk, 'number');
  assert.equal(typeof snapshot.report.controlPreservation.score, 'number');
  assert.ok(Array.isArray(snapshot.report.executionGuidance.recommendedActions));
  assert.equal(typeof snapshot.report.risk.calibration.expectedCalibrationError, 'number');
  assert.ok(snapshot.report.analysis);
  assert.ok(snapshot.report.analysis.standardEventStream);
  assert.ok(snapshot.report.analysis.standardEventStream.totalEvents > 0);
  assert.ok(snapshot.report.analysis.standardEventStream.toolCallEvents >= 0);
});
