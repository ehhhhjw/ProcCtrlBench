const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  loadBenchmarkTrajectory,
} = require('../../dist/src/adapters/BenchmarkTrajectoryLoader.js');

const fixturesDir = path.join(__dirname, '..', 'fixtures');

test('benchmark trajectory loader supports android-bench sample', () => {
  const loaded = loadBenchmarkTrajectory(
    path.join(fixturesDir, 'android-bench-sample.json'),
    'android-bench'
  );

  assert.equal(loaded.metadata.benchmark, 'android-bench');
  assert.equal(loaded.metadata.success, true);
  assert.equal(loaded.sessionData.statistics.totalMessages, 4);
  assert.equal(loaded.sessionData.statistics.totalToolUses, 1);
});

test('benchmark trajectory loader supports terminal-bench sample', () => {
  const loaded = loadBenchmarkTrajectory(
    path.join(fixturesDir, 'terminal-bench-sample.json'),
    'terminal-bench'
  );

  assert.equal(loaded.metadata.benchmark, 'terminal-bench');
  assert.equal(loaded.metadata.taskId, 'hello-world');
  assert.equal(loaded.sessionData.statistics.totalToolUses, 1);
  assert.equal(loaded.sessionData.toolResults.size, 1);
});

test('benchmark trajectory loader supports swe-bench sample', () => {
  const loaded = loadBenchmarkTrajectory(
    path.join(fixturesDir, 'swe-bench-sample.traj'),
    'swe-bench'
  );

  assert.equal(loaded.metadata.benchmark, 'swe-bench-verified');
  assert.equal(loaded.sessionData.statistics.totalMessages, 4);
  assert.equal(loaded.sessionData.statistics.totalToolUses, 2);
});
