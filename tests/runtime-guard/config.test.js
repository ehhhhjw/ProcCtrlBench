const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  loadGuardConfig,
  normalizeGuardConfig,
  DEFAULT_GUARD_CONFIG,
} = require('../../dist/tools/claude-code-runtime-guard/src/config.js');

test('normalizeGuardConfig fills missing benchmark settings', () => {
  const config = normalizeGuardConfig({
    benchmarks: {
      ghostContext: {
        enabled: false,
      },
    },
  });

  assert.equal(config.benchmarks.ghostContext.enabled, false);
  assert.equal(config.benchmarks.toolCallChain.enabled, true);
  assert.equal(config.benchmarks.deadStep.specialRules.writeNeverDeadStep, true);
});

test('loadGuardConfig merges partial file config with defaults', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-config-'));
  const configPath = path.join(tempDir, 'guard.json');

  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        runtime: {
          actions: {
            blockHighRiskPreToolUse: true,
          },
        },
        benchmarks: {
          weakTool: {
            enabled: false,
            mode: 'observe',
          },
        },
      },
      null,
      2
    )
  );

  const config = loadGuardConfig(configPath);

  assert.equal(config.runtime.actions.blockHighRiskPreToolUse, true);
  assert.equal(config.benchmarks.weakTool.enabled, false);
  assert.equal(config.benchmarks.weakTool.mode, 'observe');
  assert.equal(config.benchmarks.longChain.mode, DEFAULT_GUARD_CONFIG.benchmarks.longChain.mode);
});
