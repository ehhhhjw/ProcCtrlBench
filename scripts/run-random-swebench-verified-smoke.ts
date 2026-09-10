import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  buildBenchmarkLaunchArtifacts,
  loadBenchmarkRunConfig,
  writeBenchmarkLaunchArtifacts,
} from '../src/config/benchmark-run-config';
import {
  SweBenchVerifiedQuestion,
  choosePreferredTranscriptPath,
  defaultPythonBin,
  evaluateCodexTranscriptToObservedRecord,
  prepareGitWorktree,
  removeGitWorktree,
  resolveVerificationPlan,
  runVerificationPlan,
  selectRandomQuestions,
  writeProcBenchOutputs,
} from '../src/benchmark/SweBenchVerifiedSmoke';

function parseArgs(argv: string[]) {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }
    parsed[token.slice(2)] =
      argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : 'true';
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const count = Number(args.count || 2);
  if (!Number.isFinite(count) || count <= 0) {
    throw new Error(`Invalid --count: ${args.count}`);
  }

  const seed = args.seed ? Number(args.seed) : Date.now();
  if (!Number.isFinite(seed)) {
    throw new Error(`Invalid --seed: ${args.seed}`);
  }

  const configPath = args.config || path.join('config', 'benchmark-model.config.yaml');
  const config = loadBenchmarkRunConfig(configPath);
  const sweConfig = config.benchmarks.sweBenchVerified;
  const questionsPath = path.resolve(args['questions-path'] || sweConfig.questionsPath);
  const projectsRoot = path.resolve(args['projects-root'] || sweConfig.projectsRoot);
  const outputRoot = path.resolve(
    args.output ||
      path.join(process.cwd(), 'output', 'swebench-verified-random-smoke', String(seed))
  );
  const variant = args.variant || `random-smoke-${seed}`;
  const keepWorktrees = args['keep-worktrees'] === 'true';
  const dryRun = args['dry-run'] === 'true';
  const skipRunner = args['skip-runner'] === 'true';
  const pythonBin = defaultPythonBin(args['python-bin']);
  const runnerPython = args['runner-python'] || 'python3';
  const reuseWorktreesRoot = args['reuse-worktrees-root']
    ? path.resolve(args['reuse-worktrees-root'])
    : null;
  const reuseRunsRoot = args['reuse-runs-root'] ? path.resolve(args['reuse-runs-root']) : null;

  if (skipRunner && !reuseRunsRoot) {
    throw new Error('--skip-runner requires --reuse-runs-root');
  }

  const questions = loadQuestions(questionsPath).filter((question) =>
    fs.existsSync(path.join(projectsRoot, question.instance_id))
  );
  if (questions.length < count) {
    throw new Error(
      `Requested ${count} questions but only ${questions.length} project directories exist under ${projectsRoot}`
    );
  }

  const selected = selectRandomQuestions(questions, count, seed);
  const selectedManifest = selected.map((question) => ({
    repo: question.repo,
    instance_id: question.instance_id,
    base_commit: question.base_commit,
  }));

  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(
    path.join(outputRoot, 'selected-instances.json'),
    JSON.stringify({ seed, count, selected: selectedManifest }, null, 2),
    'utf-8'
  );

  if (dryRun) {
    console.log(`Dry run only. Seed=${seed}`);
    console.log(JSON.stringify(selectedManifest, null, 2));
    return;
  }

  const artifactsRoot = path.join(outputRoot, 'artifacts');
  const artifacts = buildBenchmarkLaunchArtifacts(config, { outputDir: artifactsRoot });
  writeBenchmarkLaunchArtifacts(artifacts, artifactsRoot);
  const sweArtifact = artifacts.find((artifact) => artifact.benchmarkId === 'swe-bench-verified');
  if (!sweArtifact) {
    throw new Error('Failed to build SWE-bench-verified launch artifacts');
  }

  const worktreesRoot = reuseWorktreesRoot || path.join(outputRoot, 'worktrees');
  const runsRoot = reuseRunsRoot || path.join(outputRoot, 'agent-runs');
  const procbenchRoot = path.join(outputRoot, 'procbench');
  const validationRoot = path.join(outputRoot, 'validation');
  fs.mkdirSync(worktreesRoot, { recursive: true });
  fs.mkdirSync(runsRoot, { recursive: true });
  fs.mkdirSync(procbenchRoot, { recursive: true });
  fs.mkdirSync(validationRoot, { recursive: true });

  const selectedQuestionsPath = path.join(outputRoot, 'selected-questions.json');
  fs.writeFileSync(selectedQuestionsPath, JSON.stringify(selected, null, 2), 'utf-8');

  const preparedWorktrees = selected.map((question) => ({
    question,
    sourceRepoPath: path.join(projectsRoot, question.instance_id),
    worktreeDir: path.join(worktreesRoot, question.instance_id),
  }));

  try {
    if (!reuseWorktreesRoot) {
      for (const item of preparedWorktrees) {
        prepareGitWorktree(item.sourceRepoPath, item.worktreeDir, item.question.base_commit);
      }
    } else {
      for (const item of preparedWorktrees) {
        if (!fs.existsSync(item.worktreeDir)) {
          throw new Error(`Missing reused worktree for ${item.question.instance_id}: ${item.worktreeDir}`);
        }
      }
    }

    let runnerExitCode: number | null = null;
    if (!skipRunner) {
      const runnerPath = path.join(
        artifactsRoot,
        'swe-bench-verified',
        'swebench_verified_runner.py'
      );
      const runnerEnv = {
        ...process.env,
        ...sweArtifact.env,
        PROC_BENCH_RERUN_EXISTING: '1',
      };
      const runnerArgs = [
        runnerPath,
        '--projects-root',
        worktreesRoot,
        '--questions-path',
        selectedQuestionsPath,
        '--experiments-root',
        sweConfig.experimentsRoot,
        '--output-dir',
        runsRoot,
        '--limit',
        String(count),
      ];

      const runnerResult = spawnSync(runnerPython, runnerArgs, {
        cwd: process.cwd(),
        env: runnerEnv,
        stdio: 'inherit',
      });
      runnerExitCode = runnerResult.status;
    }

    const validationResults = [];
    const procbenchRecords = [];
    const executionFailures: Array<Record<string, unknown>> = [];

    for (const item of preparedWorktrees) {
      const runDir = path.join(runsRoot, item.question.instance_id);
      const recordPath = path.join(runDir, 'record.json');
      const record = fs.existsSync(recordPath)
        ? JSON.parse(fs.readFileSync(recordPath, 'utf-8'))
        : null;

      const plan = resolveVerificationPlan(item.question, item.worktreeDir, pythonBin);
      const validation = runVerificationPlan(
        plan,
        item.worktreeDir,
        path.join(validationRoot, item.question.instance_id),
        item.question
      );
      validationResults.push(validation);

      const transcriptPath = choosePreferredTranscriptPath(runDir, record || undefined);
      if (!transcriptPath) {
        executionFailures.push({
          instance_id: item.question.instance_id,
          reason: 'missing_codex_rollout_transcript',
          runDir,
          recordPath,
        });
        continue;
      }

      const reportDir = path.join(
        procbenchRoot,
        'reports',
        'swe-bench-verified',
        item.question.instance_id,
        'single'
      );
      const observedRecord = await evaluateCodexTranscriptToObservedRecord(
        transcriptPath,
        item.question,
        reportDir,
        variant,
        validation.success
      );
      procbenchRecords.push(observedRecord);
    }

    writeProcBenchOutputs(procbenchRecords, procbenchRoot);

    const runSummary = {
      seed,
      count,
      variant,
      pythonBin,
      runnerPython,
      skipRunner,
      reuseWorktreesRoot,
      reuseRunsRoot,
      selected: selectedManifest,
      runnerExitCode,
      validationResults,
      procbenchRecordCount: procbenchRecords.length,
      executionFailures,
    };
    fs.writeFileSync(
      path.join(outputRoot, 'run-summary.json'),
      JSON.stringify(runSummary, null, 2),
      'utf-8'
    );

    console.log(`Random SWE smoke completed. Seed=${seed}`);
    console.log(`Selected instances: ${selectedManifest.map((item) => item.instance_id).join(', ')}`);
    console.log(`ProcBench outputs: ${procbenchRoot}`);
    if (executionFailures.length > 0) {
      console.log(`Execution failures recorded: ${executionFailures.length}`);
    }
  } finally {
    if (!keepWorktrees && !reuseWorktreesRoot) {
      for (const item of preparedWorktrees) {
        removeGitWorktree(item.sourceRepoPath, item.worktreeDir);
      }
    }
  }
}

function loadQuestions(filePath: string): SweBenchVerifiedQuestion[] {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`${filePath} must contain a JSON array`);
  }
  return parsed as SweBenchVerifiedQuestion[];
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
