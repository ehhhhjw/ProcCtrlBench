const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadCodexRolloutSession } = require('../../dist/src/adapters/CodexRolloutLoader.js');

const fixturesDir = path.join(__dirname, '..', 'fixtures');

test('codex rollout loader converts rollout events into session data', () => {
  const session = loadCodexRolloutSession(
    path.join(fixturesDir, 'codex-rollout-sample.jsonl')
  );

  assert.equal(session.statistics.totalMessages, 8);
  assert.equal(session.statistics.totalToolUses, 2);
  assert.equal(session.statistics.toolUsesByName.Bash, 2);

  const toolResults = [...session.toolResults.values()];
  assert.equal(toolResults.length, 2);
  assert.equal(toolResults[0].is_error, false);
  assert.equal(toolResults[1].is_error, true);
  assert.match(toolResults[1].content, /FAILED tests\/test_sample.py::test_issue/);
});
