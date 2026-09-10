const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  buildBenchmarkLaunchArtifacts,
  loadBenchmarkRunConfig,
} = require('../../dist/src/config/benchmark-run-config.js');

test('benchmark model config loads YAML and resolves env placeholders', () => {
  process.env.PROC_BENCH_TEST_API_KEY = 'fixture-key';

  const config = loadBenchmarkRunConfig(
    path.join(process.cwd(), 'tests/fixtures/benchmark-model-config.yaml')
  );

  assert.equal(config.model.baseUrl, 'https://api.example.com/v1');
  assert.equal(config.model.apiKey, 'fixture-key');
  assert.equal(config.model.model, 'qwen3-coder-plus');
  assert.equal(config.acoder.enabled, true);
  assert.equal(config.acoder.bin, 'acoder');
  assert.equal(config.acoder.agent, 'auto');
  assert.equal(config.benchmarks.androidBench.providerPrefix, 'openai');
  assert.equal(config.benchmarks.terminalBench.agent, 'auto');
  assert.equal(config.benchmarks.terminalBench.globalTestTimeoutSec, 180);
  assert.equal(config.benchmarks.sweBenchVerified.scaffold, 'openhands');
  assert.equal(config.benchmarks.sweBenchVerified.questionsPath, '/tmp/swe-questions.json');
});

test('benchmark model config renders launch artifacts for three benchmarks', () => {
  process.env.PROC_BENCH_TEST_API_KEY = 'fixture-key';

  const config = loadBenchmarkRunConfig(
    path.join(process.cwd(), 'tests/fixtures/benchmark-model-config.yaml')
  );
  const artifacts = buildBenchmarkLaunchArtifacts(config);

  assert.equal(artifacts.length, 3);

  const android = artifacts.find((artifact) => artifact.benchmarkId === 'android-bench');
  assert.ok(android);
  assert.equal(android.resolvedModel, 'openai/qwen3-coder-plus');
  assert.equal(android.env.OPENAI_API_KEY, 'fixture-key');
  assert.equal(android.env.PROC_BENCH_ACODER_TRUST_RESPONSE, '1');
  assert.match(android.command, /androidbench\.py/);
  assert.match(android.command, /uv run python harness\/inference\/androidbench\.py/);
  assert.match(android.command, /AcoderMiniSweAgentModel/);
  assert.match(android.command, /--model 'openai\/qwen3-coder-plus'/);
  assert.ok(
    android.files.some(
      (file) =>
        file.relativePath === 'androidbench.generated.yaml' &&
        file.content.includes('model_name: "openai/qwen3-coder-plus"')
    )
  );
  assert.ok(
    android.files.some(
      (file) =>
        file.relativePath === 'acoder_android_model.py' &&
        file.content.includes('class AcoderMiniSweAgentModel') &&
        file.content.includes("input=_trust_response_input()")
    )
  );
  assert.ok(
    android.files.some(
      (file) =>
        file.relativePath === 'launch.sh' &&
        file.content.includes('command -v "$ACODER_BIN"') &&
        file.content.includes('AcoderMiniSweAgentModel')
    )
  );

  const terminal = artifacts.find((artifact) => artifact.benchmarkId === 'terminal-bench');
  assert.ok(terminal);
  assert.equal(terminal.resolvedModel, 'openai/qwen3-coder-plus');
  assert.equal(terminal.env.OPENAI_API_KEY, 'fixture-key');
  assert.equal(terminal.env.PROC_BENCH_ACODER_TRUST_RESPONSE, '1');
  assert.match(terminal.command, /tb run/);
  assert.match(terminal.command, /--agent-import-path 'acoder_terminal_agent:AcoderTerminalBenchAgent'/);
  assert.match(terminal.command, /delegate_agent=opencode/);
  assert.match(terminal.command, /--model 'openai\/qwen3-coder-plus'/);
  assert.match(terminal.command, /--global-test-timeout-sec 180/);
  assert.match(terminal.command, /cd '\/tmp\/terminal-bench' && uv run tb run/);
  assert.ok(
    terminal.files.some(
      (file) =>
        file.relativePath === 'acoder_terminal_agent.py' &&
        file.content.includes('class AcoderTerminalBenchAgent') &&
        file.content.includes("printf '%s\\\\n' \"$PROC_BENCH_ACODER_TRUST_RESPONSE\" | ")
    )
  );
  assert.ok(
    terminal.files.some(
      (file) =>
        file.relativePath === 'launch.sh' &&
        file.content.includes('source "$SCRIPT_DIR/env.sh"') &&
        file.content.includes('unset VIRTUAL_ENV') &&
        file.content.includes('command -v "$ACODER_BIN"') &&
        file.content.includes("AcoderTerminalBenchAgent") &&
        file.content.includes('--global-test-timeout-sec 180') &&
        file.content.includes('docker info >/dev/null 2>&1')
    )
  );

  const swe = artifacts.find((artifact) => artifact.benchmarkId === 'swe-bench-verified');
  assert.ok(swe);
  assert.equal(swe.resolvedModel, 'openai/qwen3-coder-plus');
  assert.equal(swe.env.LLM_MODEL, 'qwen3-coder-plus');
  assert.equal(swe.env.PROC_BENCH_ACODER_TRUST_RESPONSE, '1');
  assert.ok(
    swe.warnings.some((warning) =>
      warning.includes('does not exist: /tmp/swe-projects')
    )
  );
  assert.ok(
    swe.warnings.some((warning) =>
      warning.includes('does not exist: /tmp/swe-questions.json')
    )
  );
  assert.ok(
    swe.files.some(
      (file) =>
        file.relativePath === 'swebench_verified_runner.py' &&
        file.content.includes('--questions-path') &&
        file.content.includes('questions_path = Path(args.questions_path)') &&
        file.content.includes('missing_projects') &&
        file.content.includes('candidate_jsonl_paths') &&
        file.content.includes('copy_matching_jsonl') &&
        file.content.includes('"copied_jsonl": copied_jsonl') &&
        file.content.includes('history.jsonl') &&
        file.content.includes('git_stash_push(') &&
        file.content.includes('def normalize_prompt_text(value: str) -> str:') &&
        file.content.includes('return normalize_prompt_text(str(metadata.get("problem_statement", "")).strip())') &&
        file.content.includes('result_patch.diff') &&
        file.content.includes('"result_patch_path": str(result_patch_path)') &&
        file.content.includes("import pty") &&
        file.content.includes("import re") &&
        file.content.includes("import select") &&
        file.content.includes("pty.openpty()") &&
        file.content.includes("def normalized_terminal_text(buffer: bytes) -> str:") &&
        file.content.includes("COMPLETION_HINT_PATTERNS = (") &&
        file.content.includes("def has_substantive_terminal_output(chunk: bytes) -> bool:") &&
        file.content.includes("def buffer_has_completion_hint(buffer: bytes) -> bool:") &&
        file.content.includes("should_auto_confirm_trust_prompt(buffer[-8192:])") &&
        file.content.includes("sent acoder trust confirmation attempt") &&
        file.content.includes("detected completion hint in acoder output; idle-exit is now armed") &&
        file.content.includes('PROC_BENCH_ACODER_IDLE_EXIT_SEC') &&
        file.content.includes('sent Ctrl-D to request acoder exit') &&
        file.content.includes('completion_hint_seen') &&
        file.content.includes('last_substantive_output_at') &&
        file.content.includes('"timed_out": timed_out') &&
        file.content.includes('"error_message": error_message') &&
        file.content.includes('"idle_exit_events": idle_exit_events') &&
        file.content.includes("sync_acoder_cli_config(acoder_agent, acoder_model)") &&
        file.content.includes('configured acoder currentProvider=') &&
        file.content.includes('restore_acoder_cli_config(acoder_config_snapshot)') &&
        file.content.includes('load_existing_record(record_path)') &&
        file.content.includes('PROC_BENCH_RERUN_EXISTING') &&
        file.content.includes('skipping {instance_id}: existing run record found at {record_path}') &&
        file.content.includes('"skipped_existing": skipped_existing') &&
        file.content.includes('args = [acoder_bin]') &&
        file.content.includes('args.append("-y")') &&
        file.content.includes('args.extend(["--", prompt])') &&
        file.content.includes('describe_command(acoder_bin)') &&
        !file.content.includes('raise subprocess.TimeoutExpired') &&
        !file.content.includes('--agent", acoder_agent') &&
        !file.content.includes('--model", model') &&
        !file.content.includes('create_worktree(')
    )
  );
  assert.ok(
    swe.files.some(
      (file) =>
        file.relativePath === 'launch.sh' &&
        file.content.includes('command -v "$ACODER_BIN"') &&
        file.content.includes("--questions-path '/tmp/swe-questions.json'") &&
        file.content.includes('PYTHONUNBUFFERED=1 exec python3 -u "$SCRIPT_DIR/swebench_verified_runner.py"') &&
        file.content.includes('"$@"') &&
        !file.content.includes('--acoder-agent') &&
        !file.content.includes('--model ') &&
        file.content.includes('swebench_verified_runner.py')
    )
  );
});

test('benchmark model config supports generic model replacement like gpt-4-turbo-128k', () => {
  process.env.PROC_BENCH_TEST_API_KEY = 'fixture-key';

  const config = loadBenchmarkRunConfig(
    path.join(process.cwd(), 'tests/fixtures/benchmark-model-config.yaml')
  );
  config.model.model = 'gpt-4-turbo-128k';

  const artifacts = buildBenchmarkLaunchArtifacts(config);
  const android = artifacts.find((artifact) => artifact.benchmarkId === 'android-bench');
  const terminal = artifacts.find((artifact) => artifact.benchmarkId === 'terminal-bench');
  const swe = artifacts.find((artifact) => artifact.benchmarkId === 'swe-bench-verified');

  assert.equal(android.resolvedModel, 'openai/gpt-4-turbo-128k');
  assert.match(android.command, /AcoderMiniSweAgentModel/);
  assert.equal(terminal.resolvedModel, 'gpt-4-turbo-128k');
  assert.equal(terminal.env.LLM_MODEL, 'gpt-4-turbo-128k');
  assert.match(terminal.command, /delegate_agent=codex/);
  assert.match(terminal.command, /AcoderTerminalBenchAgent/);
  assert.match(terminal.command, /--global-test-timeout-sec 180/);
  assert.match(terminal.command, /cd '\/tmp\/terminal-bench' && uv run tb run/);
  assert.equal(swe.env.LLM_MODEL, 'gpt-4-turbo-128k');
  assert.doesNotMatch(
    swe.files.find((file) => file.relativePath === 'launch.sh').content,
    /--acoder-agent 'codex'/
  );
  assert.match(android.command, /uv run python harness\/inference\/androidbench\.py/);
});
