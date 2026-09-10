const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  TranscriptWatcher,
} = require('../../dist/tools/claude-code-runtime-guard/src/transcript-watcher.js');

test('transcript watcher reacts to appended jsonl content', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-watch-'));
  const transcriptPath = path.join(tempDir, 'session.jsonl');
  fs.writeFileSync(transcriptPath, '{"type":"user"}\n');

  let seen = 0;
  const watcher = new TranscriptWatcher({
    pollIntervalMs: 50,
    onUpdate: () => {
      seen += 1;
    },
  });

  watcher.watch(transcriptPath);

  await new Promise((resolve) => setTimeout(resolve, 80));
  fs.appendFileSync(transcriptPath, '{"type":"assistant"}\n');
  await new Promise((resolve) => setTimeout(resolve, 220));

  watcher.close();
  assert.ok(seen >= 1);
});
