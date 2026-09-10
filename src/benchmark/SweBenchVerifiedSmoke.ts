import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { AgentEvaluator } from '../AgentEvaluator';
import { loadCodexRolloutSession } from '../adapters/CodexRolloutLoader';
import { BenchmarkTrajectoryMetadata } from '../adapters/BenchmarkTrajectoryLoader';
import {
  ObservedBenchmarkSummaryRow,
  ObservedTrajectoryRecord,
  SweControlSummaryRow,
  aggregateObservedBenchmarkSummaries,
  computeDefectFailureCorrelations,
  computeSweControlSummary,
  reportToObservedTrajectoryRecord,
} from './ObservedBenchmarkExperiments';

export interface SweBenchVerifiedQuestion {
  repo: string;
  instance_id: string;
  base_commit: string;
  problem_statement: string;
  FAIL_TO_PASS: string[] | string;
  PASS_TO_PASS: string[] | string;
  [key: string]: unknown;
}

export interface ValidationCommandResult {
  suite: 'fail_to_pass' | 'pass_to_pass';
  batchIndex: number;
  command: string[];
  targetCount: number;
  exitCode: number | null;
  timedOut: boolean;
  stdoutPath: string;
  stderrPath: string;
  durationMs: number;
}

export interface VerificationPlan {
  runner: 'pytest' | 'django';
  failToPassTargets: string[];
  passToPassTargets: string[];
  unresolvedLabels: string[];
  commandPrefix: string[];
}

export interface InstanceValidationSummary {
  instanceId: string;
  repo: string;
  success: boolean;
  unresolvedLabels: string[];
  failToPassTargets: string[];
  passToPassTargets: string[];
  commands: ValidationCommandResult[];
}

/**
 * Probe the candidates in order for an available Python interpreter.
 * Most SWE-bench-Verified tasks require 3.10; if your interpreter is not on PATH,
 * use PROCCTRL_PYTHON_BIN to point at an absolute path.
 */
const DEFAULT_PYTHON_BIN_CANDIDATES = [
  ...(process.env.PROCCTRL_PYTHON_BIN ? [process.env.PROCCTRL_PYTHON_BIN] : []),
  'python3.10',
  'python3',
  'python',
] as const;

const DJANGO_PROSE_TARGET_OVERRIDES: Record<string, string[]> = {
  [normalizeSearchText('AlterField operation of db_collation on primary keys changes any FKs')]: [
    'test_alter_field_pk_fk',
  ],
  [normalizeSearchText('Creation of models with a FK to a PK with db_collation.')]: [
    'test_relation_fields_db_collation',
    'test_db_parameters_propagate_target_field_collation',
  ],
  [normalizeSearchText('Altering an FK to a non-FK works (#23244)')]: [
    'test_alter_fk_non_fk',
  ],
  [normalizeSearchText('The AlterModelOptions operation removes keys from the dict (#23121)')]: [
    'test_alter_model_options_emptying',
  ],
};

export function parseQuestionLabels(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter(Boolean);
  }
  if (typeof value !== 'string') {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return parseQuestionLabels(parsed);
  } catch {
    return value
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

export function createSeededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) & 0xffffffff) / 0x100000000;
  };
}

export function selectRandomQuestions(
  questions: SweBenchVerifiedQuestion[],
  count: number,
  seed: number
): SweBenchVerifiedQuestion[] {
  const remaining = [...questions];
  const random = createSeededRandom(seed);
  const picked: SweBenchVerifiedQuestion[] = [];
  while (remaining.length > 0 && picked.length < count) {
    const index = Math.floor(random() * remaining.length);
    picked.push(remaining.splice(index, 1)[0]);
  }
  return picked;
}

export function defaultPythonBin(explicitBin?: string): string {
  const candidates = explicitBin
    ? [explicitBin, ...DEFAULT_PYTHON_BIN_CANDIDATES]
    : [...DEFAULT_PYTHON_BIN_CANDIDATES];
  for (const candidate of candidates) {
    if (isExecutable(candidate)) {
      return candidate;
    }
  }
  return 'python3';
}

export function prepareGitWorktree(
  sourceRepoPath: string,
  targetDir: string,
  commit: string
) {
  ensureDir(path.dirname(targetDir));
  removeGitWorktree(sourceRepoPath, targetDir);
  runCheckedCommand(
    'git',
    ['-C', sourceRepoPath, 'worktree', 'add', '--force', '--detach', targetDir, commit],
    path.dirname(targetDir)
  );
}

export function removeGitWorktree(sourceRepoPath: string, targetDir: string) {
  try {
    spawnSync('git', ['-C', sourceRepoPath, 'worktree', 'remove', '--force', targetDir], {
      encoding: 'utf-8',
      stdio: 'pipe',
    });
  } catch {
    // Ignore cleanup failures. A stale directory will be force-removed below.
  }
  fs.rmSync(targetDir, { recursive: true, force: true });
}

export function choosePreferredTranscriptPath(
  runDir: string,
  record?: Record<string, any>
): string | null {
  const candidates = new Set<string>();
  const copiedJsonl = Array.isArray(record?.copied_jsonl) ? record?.copied_jsonl : [];
  for (const item of copiedJsonl) {
    if (typeof item === 'string') {
      candidates.add(item);
    }
  }

  const jsonlDir = path.join(runDir, 'jsonl');
  if (fs.existsSync(jsonlDir)) {
    for (const entry of fs.readdirSync(jsonlDir)) {
      if (entry.endsWith('.jsonl')) {
        candidates.add(path.join(jsonlDir, entry));
      }
    }
  }

  const sessionsDir = path.join(runDir, '.codex-home', 'sessions');
  if (fs.existsSync(sessionsDir)) {
    for (const candidate of walkFiles(sessionsDir)) {
      if (path.basename(candidate).startsWith('rollout-') && candidate.endsWith('.jsonl')) {
        candidates.add(candidate);
      }
    }
  }

  const fallbackHistory = path.join(runDir, '.codex-home', 'history.jsonl');
  if (fs.existsSync(fallbackHistory)) {
    candidates.add(fallbackHistory);
  }

  const sorted = [...candidates]
    .filter((candidate) => fs.existsSync(candidate))
    .sort((left, right) => transcriptPriority(left) - transcriptPriority(right));

  return sorted.find((candidate) => looksLikeCodexRolloutTranscript(candidate)) || null;
}

export function looksLikeCodexRolloutTranscript(filePath: string): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  const firstLine = fs
    .readFileSync(filePath, 'utf-8')
    .split('\n')
    .find((line) => line.trim());
  if (!firstLine) {
    return false;
  }
  return (
    firstLine.includes('"type":"session_meta"') ||
    firstLine.includes('"type": "session_meta"') ||
    firstLine.includes('"type":"response_item"') ||
    firstLine.includes('"type": "response_item"')
  );
}

export function resolveVerificationPlan(
  question: SweBenchVerifiedQuestion,
  projectDir: string,
  pythonBin: string
): VerificationPlan {
  const unresolvedLabels: string[] = [];
  const failToPassTargets = resolveLabels(
    parseQuestionLabels(question.FAIL_TO_PASS),
    question.repo,
    projectDir,
    unresolvedLabels
  );
  const passToPassTargets = resolveLabels(
    parseQuestionLabels(question.PASS_TO_PASS),
    question.repo,
    projectDir,
    unresolvedLabels
  );

  if (question.repo === 'django/django') {
    return {
      runner: 'django',
      failToPassTargets,
      passToPassTargets,
      unresolvedLabels: dedupe(unresolvedLabels),
      commandPrefix: [pythonBin, 'tests/runtests.py', '--parallel', '1'],
    };
  }

  return {
    runner: 'pytest',
    failToPassTargets,
    passToPassTargets,
    unresolvedLabels: dedupe(unresolvedLabels),
    commandPrefix: [pythonBin, '-m', 'pytest', '-o', 'addopts='],
  };
}

export function runVerificationPlan(
  plan: VerificationPlan,
  projectDir: string,
  outputDir: string,
  question: SweBenchVerifiedQuestion,
  timeoutSec = 1800
): InstanceValidationSummary {
  ensureDir(outputDir);
  const commands: ValidationCommandResult[] = [];
  let success = plan.unresolvedLabels.length === 0;

  for (const suiteName of ['fail_to_pass', 'pass_to_pass'] as const) {
    const targets =
      suiteName === 'fail_to_pass' ? plan.failToPassTargets : plan.passToPassTargets;
    const batches = chunkTargets(targets, plan.runner === 'django' ? 15 : 25);

    for (let index = 0; index < batches.length; index++) {
      const batch = batches[index];
      const command = [...plan.commandPrefix, ...batch];
      const started = Date.now();
      const result = spawnSync(command[0], command.slice(1), {
        cwd: projectDir,
        env: buildVerificationEnv(projectDir, plan.runner),
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
        timeout: timeoutSec * 1000,
      });
      const durationMs = Date.now() - started;
      const stdoutPath = path.join(outputDir, `${suiteName}-${index + 1}.stdout.txt`);
      const stderrPath = path.join(outputDir, `${suiteName}-${index + 1}.stderr.txt`);
      fs.writeFileSync(stdoutPath, result.stdout || '', 'utf-8');
      fs.writeFileSync(stderrPath, result.stderr || '', 'utf-8');

      const exitCode = typeof result.status === 'number' ? result.status : null;
      const timedOut = Boolean(result.error && /timed out/i.test(result.error.message));
      if (exitCode !== 0 || timedOut || result.error) {
        success = false;
      }

      commands.push({
        suite: suiteName,
        batchIndex: index + 1,
        command,
        targetCount: batch.length,
        exitCode,
        timedOut,
        stdoutPath,
        stderrPath,
        durationMs,
      });
    }
  }

  return {
    instanceId: question.instance_id,
    repo: question.repo,
    success,
    unresolvedLabels: plan.unresolvedLabels,
    failToPassTargets: plan.failToPassTargets,
    passToPassTargets: plan.passToPassTargets,
    commands,
  };
}

export async function evaluateCodexTranscriptToObservedRecord(
  transcriptPath: string,
  question: SweBenchVerifiedQuestion,
  reportDir: string,
  variant: string,
  success: boolean | null
): Promise<ObservedTrajectoryRecord> {
  ensureDir(reportDir);
  const session = loadCodexRolloutSession(transcriptPath);
  const report = await withTreeSitterDisabledForRollout(async () => {
    const evaluator = new AgentEvaluator(session);
    return evaluator.evaluateAndSave(reportDir, ['json', 'markdown']);
  });
  const reportJson = fs
    .readdirSync(reportDir)
    .find((entry) => entry.startsWith('evaluation-') && entry.endsWith('.json'));

  const metadata: BenchmarkTrajectoryMetadata = {
    source: 'swe-bench',
    benchmark: 'swe-bench-verified',
    taskId: question.instance_id,
    success: typeof success === 'boolean' ? success : undefined,
    status: typeof success === 'boolean' ? (success ? 'passed' : 'failed') : 'unknown',
    rawPath: transcriptPath,
  };

  return reportToObservedTrajectoryRecord(metadata, report, {
    variant,
    reportPath: reportJson ? path.join(reportDir, reportJson) : reportDir,
  });
}

async function withTreeSitterDisabledForRollout<T>(run: () => Promise<T>): Promise<T> {
  if (process.env.PROC_BENCH_ENABLE_TREE_SITTER_FOR_ROLLOUT === '1') {
    return run();
  }

  const previous = process.env.PROC_BENCH_DISABLE_TREE_SITTER;
  process.env.PROC_BENCH_DISABLE_TREE_SITTER = '1';
  try {
    return await run();
  } finally {
    if (typeof previous === 'string') {
      process.env.PROC_BENCH_DISABLE_TREE_SITTER = previous;
    } else {
      delete process.env.PROC_BENCH_DISABLE_TREE_SITTER;
    }
  }
}

export function writeProcBenchOutputs(records: ObservedTrajectoryRecord[], outRoot: string) {
  ensureDir(outRoot);
  const benchmarkSummary = aggregateObservedBenchmarkSummaries(records);
  const defectOverall = computeDefectFailureCorrelations(records, 'all');
  const defectByBenchmark = [...new Set(records.map((record) => record.benchmark))]
    .sort()
    .flatMap((benchmark) => computeDefectFailureCorrelations(records, benchmark));
  const sweControl = computeSweControlSummary(records);

  writeJsonl(path.join(outRoot, 'trajectory-records.jsonl'), records);
  writeCsv(records, path.join(outRoot, 'trajectory-records.csv'));
  writeCsv(benchmarkSummary, path.join(outRoot, 'observed-benchmark-summary.csv'));
  writeCsv(defectOverall, path.join(outRoot, 'defect-failure-correlation-overall.csv'));
  writeCsv(
    defectByBenchmark,
    path.join(outRoot, 'defect-failure-correlation-by-benchmark.csv')
  );
  writeCsv(sweControl, path.join(outRoot, 'swe-control-preservation.csv'));
  writeObservedSummaryMarkdown(
    benchmarkSummary,
    path.join(outRoot, 'observed-benchmark-summary.md')
  );
  writeSmokeStatusMarkdown(
    path.join(outRoot, 'reproduction-status.md'),
    records,
    benchmarkSummary,
    sweControl
  );
}

function resolveLabels(
  labels: string[],
  repo: string,
  projectDir: string,
  unresolvedLabels: string[]
): string[] {
  const resolved: string[] = [];
  for (const label of labels) {
    const found = resolveLabelTargets(label, repo, projectDir);
    if (found.length > 0) {
      resolved.push(...found);
      continue;
    }
    unresolvedLabels.push(label);
  }

  return dedupe(resolved);
}

function resolveLabelTargets(label: string, repo: string, projectDir: string): string[] {
  const trimmed = label.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.includes('::') || trimmed.endsWith('.py')) {
    return [trimmed];
  }
  if (repo === 'django/django') {
    return resolveDjangoLabelTargets(trimmed, projectDir);
  }
  const direct = findPytestTargetByDefinition(projectDir, trimmed);
  if (direct) {
    return [direct];
  }
  const exact = findPytestTargetByExactText(projectDir, trimmed);
  return exact ? [exact] : [];
}

function resolveDjangoLabelTargets(label: string, projectDir: string): string[] {
  const namedMatch = label.match(/^(.*?) \(([^)]+)\)$/);
  if (namedMatch && looksLikeDjangoHint(namedMatch[2].trim())) {
    const requestedName = namedMatch[1].trim();
    const hintedPath = namedMatch[2].trim();
    const exactHintedTarget = `${hintedPath}.${requestedName}`;
    const hintedCandidates = findDjangoTargetsForHint(projectDir, hintedPath);
    if (hintedCandidates.some((candidate) => candidate.runnableLabel === exactHintedTarget)) {
      return [exactHintedTarget];
    }

    const hintedExactCandidates = hintedCandidates.filter(
      (candidate) => candidate.functionName === requestedName
    );
    if (hintedExactCandidates.length === 1) {
      return [hintedExactCandidates[0].runnableLabel as string];
    }

    const hintedFuzzy = chooseBestDjangoTargetCandidate(requestedName, hintedCandidates);
    if (hintedFuzzy) {
      return [hintedFuzzy.runnableLabel as string];
    }

    const exactCandidates = findDjangoTargetsByFunctionName(projectDir, requestedName);
    const preferredExact = preferHintedDjangoCandidate(exactCandidates, hintedPath);
    if (preferredExact) {
      return [preferredExact.runnableLabel as string];
    }
    return [];
  }

  const overrideTargets = resolveDjangoOverrideTargets(label, projectDir);
  if (overrideTargets.length > 0) {
    return overrideTargets;
  }

  return findPythonLocationsByExactText(projectDir, label)
    .map((located) => toDjangoRunnableLabel(located.filePath, located.className, located.functionName))
    .filter((target): target is string => Boolean(target));
}

function resolveDjangoOverrideTargets(label: string, projectDir: string): string[] {
  const preferredTargets = DJANGO_PROSE_TARGET_OVERRIDES[normalizeSearchText(label)];
  if (!preferredTargets) {
    return [];
  }

  const resolved: string[] = [];
  for (const preferredTarget of preferredTargets) {
    if (preferredTarget.includes('.')) {
      const candidates = findDjangoTargetsForHint(projectDir, preferredTarget);
      if (candidates.some((candidate) => candidate.runnableLabel === preferredTarget)) {
        resolved.push(preferredTarget);
      }
      continue;
    }

    const candidates = findDjangoTargetsByFunctionName(projectDir, preferredTarget);
    resolved.push(...candidates.map((candidate) => candidate.runnableLabel || '').filter(Boolean));
  }

  return dedupe(resolved);
}

function findPytestTargetByDefinition(projectDir: string, label: string): string | null {
  const candidates: string[] = [];
  for (const filePath of collectPythonFiles(projectDir)) {
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    for (let index = 0; index < lines.length; index++) {
      if (new RegExp(`^\\s*(?:async\\s+)?def\\s+${escapeRegExp(label)}\\s*\\(`).test(lines[index])) {
        const enclosing = findEnclosingPythonDefinition(filePath, index + 1);
        const relative = toPosixPath(path.relative(projectDir, filePath));
        candidates.push(
          enclosing.className
            ? `${relative}::${enclosing.className}::${label}`
            : `${relative}::${label}`
        );
      }
    }
  }

  return chooseSingleCandidate(candidates);
}

function findPytestTargetByExactText(projectDir: string, label: string): string | null {
  const matches = findPythonLocationsByExactText(projectDir, label);
  if (matches.length !== 1 || !matches[0].functionName) {
    return null;
  }
  const located = matches[0];
  const relative = toPosixPath(path.relative(projectDir, located.filePath));
  return located.className
    ? `${relative}::${located.className}::${located.functionName}`
    : `${relative}::${located.functionName}`;
}

function findPythonLocationsByExactText(projectDir: string, label: string): Array<{
  filePath: string;
  className: string | null;
  functionName: string | null;
}> {
  const exactMatches: Array<{
    filePath: string;
    className: string | null;
    functionName: string | null;
  }> = [];
  const matches: Array<{
    filePath: string;
    className: string | null;
    functionName: string | null;
  }> = [];

  for (const filePath of collectPythonFiles(projectDir)) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const exactLineNumbers = findLineNumbersBySubstring(content, label);
    if (exactLineNumbers.length > 0) {
      for (const exactLineNumber of exactLineNumbers) {
        const enclosing = findEnclosingPythonDefinition(filePath, exactLineNumber);
        exactMatches.push({
          filePath,
          className: enclosing.className,
          functionName: enclosing.functionName,
        });
      }
      continue;
    }

    const lineNumber = findLineNumberContainingText(content, label);
    if (!lineNumber) {
      continue;
    }
    const enclosing = findEnclosingPythonDefinition(filePath, lineNumber);
    matches.push({
      filePath,
      className: enclosing.className,
      functionName: enclosing.functionName,
    });
  }

  const uniqueExact = dedupeObjects(
    exactMatches,
    (item) => `${item.filePath}::${item.className || ''}::${item.functionName || ''}`
  );
  if (uniqueExact.length > 0) {
    return uniqueExact;
  }

  const unique = dedupeObjects(
    matches,
    (item) => `${item.filePath}::${item.className || ''}::${item.functionName || ''}`
  );
  return unique.length === 1 ? unique : [];
}

export function findEnclosingPythonDefinition(
  filePath: string,
  targetLine: number
): {
  className: string | null;
  functionName: string | null;
} {
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
  const stack: Array<{ kind: 'class' | 'def'; name: string; indent: number }> = [];

  for (let index = 0; index < lines.length && index + 1 <= targetLine; index++) {
    const line = lines[index];
    const match = line.match(/^(\s*)(class|def)\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (!match) {
      continue;
    }
    const indent = match[1].replace(/\t/g, '    ').length;
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    stack.push({
      kind: match[2] === 'class' ? 'class' : 'def',
      name: match[3],
      indent,
    });
  }

  const className = [...stack]
    .reverse()
    .find((entry) => entry.kind === 'class')?.name || null;
  const functionName = [...stack]
    .reverse()
    .find((entry) => entry.kind === 'def')?.name || null;

  return { className, functionName };
}

function toDjangoRunnableLabel(
  filePath: string,
  className: string | null,
  functionName: string | null
): string | null {
  if (!functionName) {
    return null;
  }
  const normalized = toPosixPath(filePath);
  const testsIndex = normalized.indexOf('/tests/');
  if (testsIndex === -1) {
    return null;
  }
  const relative = normalized.slice(testsIndex + '/tests/'.length).replace(/\.py$/, '');
  const modulePath = relative.split('/').join('.');
  if (className) {
    return `${modulePath}.${className}.${functionName}`;
  }
  return `${modulePath}.${functionName}`;
}

function findDjangoTargetsForHint(projectDir: string, hintedPath: string): PythonTarget[] {
  const parsedHint = parseDjangoHint(projectDir, hintedPath);
  if (!parsedHint?.filePath) {
    return [];
  }
  const candidates = listPythonTargetsInFile(parsedHint.filePath).filter(
    (candidate) =>
      !parsedHint.className || candidate.className === parsedHint.className
  );
  return candidates.filter((candidate) => candidate.runnableLabel !== null) as PythonTarget[];
}

function findDjangoTargetsByFunctionName(projectDir: string, functionName: string): PythonTarget[] {
  const matches: PythonTarget[] = [];
  for (const filePath of collectPythonFiles(projectDir)) {
    const candidates = listPythonTargetsInFile(filePath).filter(
      (candidate) =>
        candidate.functionName === functionName && candidate.runnableLabel !== null
    ) as PythonTarget[];
    matches.push(...candidates);
  }
  return dedupeObjects(matches, (candidate) => candidate.runnableLabel);
}

function preferHintedDjangoCandidate(
  candidates: PythonTarget[],
  hintedPath: string
): PythonTarget | null {
  if (candidates.length === 0) {
    return null;
  }
  const parsedHint = parseDjangoHintFromPath(hintedPath);
  if (!parsedHint) {
    return chooseSingleObjectCandidate(candidates);
  }
  const filtered = candidates.filter((candidate) => {
    if (parsedHint.className && candidate.className !== parsedHint.className) {
      return false;
    }
    if (
      parsedHint.modulePath &&
      (!candidate.runnableLabel ||
        !candidate.runnableLabel.startsWith(`${parsedHint.modulePath}.`))
    ) {
      return false;
    }
    return true;
  });
  return chooseSingleObjectCandidate(filtered.length > 0 ? filtered : candidates);
}

function chooseBestDjangoTargetCandidate(
  requestedName: string,
  candidates: PythonTarget[]
): PythonTarget | null {
  if (candidates.length === 0) {
    return null;
  }
  const scored = dedupeObjects(candidates, (candidate) => candidate.runnableLabel)
    .map((candidate) => ({
      candidate,
      score: scorePythonFunctionNameCandidate(requestedName, candidate.functionName),
    }))
    .filter((entry) => entry.score >= 6)
    .sort((left, right) => right.score - left.score);

  if (scored.length === 0) {
    return null;
  }
  if (scored.length === 1) {
    return scored[0].candidate;
  }
  if (scored[0].score === scored[1].score) {
    return null;
  }
  return scored[0].candidate;
}

function scorePythonFunctionNameCandidate(requestedName: string, candidateName: string): number {
  const requestedTokens = tokenizePythonIdentifier(requestedName);
  const candidateTokens = tokenizePythonIdentifier(candidateName);
  if (requestedTokens.length === 0 || candidateTokens.length === 0) {
    return 0;
  }

  const requestedSet = new Set(requestedTokens);
  const candidateSet = new Set(candidateTokens);
  const overlap = [...requestedSet].filter((token) => candidateSet.has(token)).length;
  const missing = requestedSet.size - overlap;
  const extra = candidateSet.size - overlap;

  let score = overlap * 4 - missing * 3 - extra;
  if (normalizePythonIdentifier(requestedName) === normalizePythonIdentifier(candidateName)) {
    score += 100;
  }
  if (candidateTokens.some((token) => token.includes('blank_false'))) {
    score += requestedSet.has('blank_false') ? 2 : 0;
  }
  return score;
}

function tokenizePythonIdentifier(value: string): string[] {
  const normalized = normalizePythonIdentifier(value);
  if (!normalized) {
    return [];
  }

  const baseTokens = normalized
    .split('_')
    .map((token) => token.trim())
    .filter(
      (token) =>
        token &&
        !['test', 'tests', 'with', 'and', 'or', 'for', 'to', 'field', 'fields'].includes(token)
    )
    .map((token) => singularizeToken(token));
  const tokens = new Set<string>(baseTokens);

  for (let index = 0; index < baseTokens.length - 1; index++) {
    const pair = `${baseTokens[index]}_${baseTokens[index + 1]}`;
    if (
      [
        'blank_false',
        'foreign_key',
        'radio_select',
        'null_true',
        'model_instance',
        'choice_radio',
        'radio_choice',
      ].includes(pair)
    ) {
      tokens.add(pair);
    }
  }

  return [...tokens];
}

function normalizePythonIdentifier(value: string): string {
  return value
    .toLowerCase()
    .replace(/^test[_\s-]*/, '')
    .replace(/non[_\s-]*blank/g, 'blank_false')
    .replace(/blank[_\s-]*false/g, 'blank_false')
    .replace(/foreign[_\s-]*keys?/g, 'foreign_key')
    .replace(/radio[_\s-]*select/g, 'radio_select')
    .replace(/null[_\s-]*true/g, 'null_true')
    .replace(/model[_\s-]*instance/g, 'model_instance')
    .replace(/choices/g, 'choice')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

function singularizeToken(token: string): string {
  if (token.endsWith('ies') && token.length > 3) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.endsWith('s') && !token.endsWith('ss') && token.length > 3) {
    return token.slice(0, -1);
  }
  return token;
}

function listPythonTargetsInFile(filePath: string): PythonTarget[] {
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
  const scope: Array<{ kind: 'class' | 'def'; name: string; indent: number }> = [];
  const targets: PythonTarget[] = [];

  for (const line of lines) {
    const match = line.match(/^(\s*)(class|def)\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (!match) {
      continue;
    }
    const indent = match[1].replace(/\t/g, '    ').length;
    while (scope.length > 0 && scope[scope.length - 1].indent >= indent) {
      scope.pop();
    }

    if (match[2] === 'class') {
      scope.push({ kind: 'class', name: match[3], indent });
      continue;
    }

    const className = [...scope]
      .reverse()
      .find((entry) => entry.kind === 'class')?.name || null;
    const runnableLabel = toDjangoRunnableLabel(filePath, className, match[3]);
    targets.push({
      filePath,
      className,
      functionName: match[3],
      runnableLabel,
    });
    scope.push({ kind: 'def', name: match[3], indent });
  }

  return targets;
}

function parseDjangoHint(
  projectDir: string,
  hintedPath: string
): { filePath: string | null; modulePath: string | null; className: string | null } | null {
  const parts = hintedPath.split('.').filter(Boolean);
  for (let index = parts.length; index > 0; index--) {
    const moduleParts = parts.slice(0, index);
    const candidate = path.join(projectDir, 'tests', ...moduleParts) + '.py';
    if (!fs.existsSync(candidate)) {
      continue;
    }
    return {
      filePath: candidate,
      modulePath: moduleParts.join('.'),
      className: parts[index] || null,
    };
  }

  const parsed = parseDjangoHintFromPath(hintedPath);
  if (!parsed) {
    return null;
  }
  return {
    filePath: null,
    modulePath: parsed.modulePath,
    className: parsed.className,
  };
}

function parseDjangoHintFromPath(
  hintedPath: string
): { modulePath: string | null; className: string | null } | null {
  const parts = hintedPath.split('.').filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  if (parts.length === 1) {
    return {
      modulePath: parts[0],
      className: null,
    };
  }
  const last = parts[parts.length - 1];
  const looksLikeClass = /^[A-Z]/.test(last) || /(Case|Test|Tests)$/.test(last);
  return {
    modulePath: looksLikeClass ? parts.slice(0, -1).join('.') : parts.join('.'),
    className: looksLikeClass ? last : null,
  };
}

function looksLikeDjangoHint(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(value) && value.includes('.');
}

function collectPythonFiles(projectDir: string): string[] {
  const files: string[] = [];
  const walk = (current: string) => {
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      const base = path.basename(current);
      if (['.git', '.tox', '.venv', 'node_modules', '__pycache__'].includes(base)) {
        return;
      }
      for (const entry of fs.readdirSync(current)) {
        walk(path.join(current, entry));
      }
      return;
    }
    if (current.endsWith('.py')) {
      files.push(current);
    }
  };
  walk(projectDir);
  return files.sort();
}

function walkFiles(rootDir: string): string[] {
  const files: string[] = [];
  const walk = (current: string) => {
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) {
        walk(path.join(current, entry));
      }
      return;
    }
    files.push(current);
  };
  walk(rootDir);
  return files.sort();
}

function transcriptPriority(filePath: string): number {
  const base = path.basename(filePath);
  if (base.startsWith('rollout-')) {
    return 0;
  }
  if (base === 'history.jsonl' && filePath.includes(`${path.sep}jsonl${path.sep}`)) {
    return 1;
  }
  if (base === 'responses.jsonl') {
    return 2;
  }
  if (base === 'history.jsonl') {
    return 3;
  }
  return 10;
}

function chunkTargets(targets: string[], chunkSize: number): string[][] {
  if (targets.length === 0) {
    return [];
  }
  const batches: string[][] = [];
  for (let index = 0; index < targets.length; index += chunkSize) {
    batches.push(targets.slice(index, index + chunkSize));
  }
  return batches;
}

function runCheckedCommand(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf-8',
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed in ${cwd}: ${result.stderr || result.stdout || ''}`
    );
  }
}

function isExecutable(candidate: string): boolean {
  if (candidate.includes(path.sep)) {
    return fs.existsSync(candidate);
  }
  const result = spawnSync('which', [candidate], {
    encoding: 'utf-8',
    stdio: 'pipe',
  });
  return result.status === 0;
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function findLineNumberContainingText(content: string, text: string): number {
  const lines = content.split('\n');
  const normalizedText = normalizeSearchText(text);
  if (!normalizedText) {
    return 0;
  }
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.includes(text)) {
      return index + 1;
    }
    const normalizedLine = normalizeSearchText(line);
    if (normalizedLine && normalizedLine.includes(normalizedText)) {
      return index + 1;
    }
  }
  return 0;
}

function findLineNumbersBySubstring(content: string, text: string): number[] {
  if (!text) {
    return [];
  }
  const lines: number[] = [];
  let startIndex = 0;
  while (startIndex < content.length) {
    const index = content.indexOf(text, startIndex);
    if (index === -1) {
      break;
    }
    let lineNumber = 1;
    for (let cursor = 0; cursor < index; cursor++) {
      if (content[cursor] === '\n') {
        lineNumber += 1;
      }
    }
    lines.push(lineNumber);
    startIndex = index + text.length;
  }
  return lines;
}

function buildVerificationEnv(projectDir: string, runner: VerificationPlan['runner']) {
  if (runner !== 'django') {
    return process.env;
  }
  const existingPythonPath = process.env.PYTHONPATH;
  return {
    ...process.env,
    PYTHONPATH: existingPythonPath ? `${projectDir}${path.delimiter}${existingPythonPath}` : projectDir,
  };
}

function chooseSingleCandidate(values: string[]): string | null {
  const unique = dedupe(values).sort();
  return unique.length === 1 ? unique[0] : null;
}

function chooseSingleObjectCandidate<T>(values: T[]): T | null {
  return values.length === 1 ? values[0] : null;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function dedupeObjects<T>(values: T[], keyOf: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = keyOf(value);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

interface PythonTarget {
  filePath: string;
  className: string | null;
  functionName: string;
  runnableLabel: string | null;
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/db_collation/g, 'collation')
    .replace(/foreign keys?/g, 'fks')
    .replace(/pointing to it/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(
      (token) =>
        token &&
        !['a', 'an', 'the', 'of', 'on', 'to', 'with', 'and', 'or', 'any', 'tests', 'test', 'collation'].includes(token)
    )
    .join(' ')
    .trim();
}

function writeJsonl(outPath: string, rows: unknown[]) {
  fs.writeFileSync(
    outPath,
    rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''),
    'utf-8'
  );
}

function writeCsv<T extends object>(rows: T[], outPath: string) {
  if (rows.length === 0) {
    fs.writeFileSync(outPath, '', 'utf-8');
    return;
  }

  const header = Object.keys(rows[0] as Record<string, unknown>);
  const lines = [header.join(',')];
  for (const row of rows) {
    const record = row as Record<string, unknown>;
    lines.push(header.map((key) => csvEscape(toCell(record[key]))).join(','));
  }
  fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
}

function toCell(value: unknown): string {
  if (Array.isArray(value)) {
    return value.join('|');
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (value === null || typeof value === 'undefined') {
    return '';
  }
  return String(value);
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function writeObservedSummaryMarkdown(
  rows: ObservedBenchmarkSummaryRow[],
  outPath: string
) {
  const lines: string[] = [];
  lines.push('# Observed ProcBench Summary');
  lines.push('');
  lines.push(
    'These results come from random SWE-bench-Verified smoke runs executed in isolated worktrees and then evaluated by ProcBench.'
  );
  lines.push('');
  lines.push('| Variant | Benchmark | N | Outcome | Outcome Rate | Mean Risk | Mean CP | Mean Autonomy |');
  lines.push('|---|---|---:|---|---:|---:|---:|---:|');

  for (const row of rows) {
    lines.push(
      `| ${row.variant} | ${row.benchmark} | ${row.sampleCount} | ${row.outcomeMetric} | ${formatNumber(row.outcomeRate)} | ${formatNumber(row.meanOverallRisk)} | ${formatNumber(row.meanControlPreservation)} | ${formatNumber(row.meanAutonomyLevel)} |`
    );
  }

  fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
}

function writeSmokeStatusMarkdown(
  outPath: string,
  records: ObservedTrajectoryRecord[],
  summaryRows: ObservedBenchmarkSummaryRow[],
  sweControlRows: SweControlSummaryRow[]
) {
  const lines: string[] = [];
  lines.push('# ProcBench Smoke Status');
  lines.push('');
  lines.push(
    `Observed random SWE smoke data executed in this workspace: ${records.length} transcript(s).`
  );
  lines.push('');
  if (summaryRows.length > 0) {
    const summary = summaryRows[0];
    lines.push(`- Outcome rate: ${formatNumber(summary.outcomeRate)}`);
    lines.push(`- Mean overall risk: ${formatNumber(summary.meanOverallRisk)}`);
    lines.push(`- Mean control preservation: ${formatNumber(summary.meanControlPreservation)}`);
  }
  if (sweControlRows.length > 0) {
    const swe = sweControlRows[0];
    lines.push(`- SWE fragile success rate: ${formatNumber(swe.fragileSuccessRate)}`);
  }
  lines.push('');
  lines.push(
    'This smoke harness reports what happened on the sampled instances; it does not convert random smoke outcomes into a claim about the full benchmark.'
  );
  fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(4) : '0.0000';
}
