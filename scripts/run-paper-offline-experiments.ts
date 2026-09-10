import * as fs from 'fs';
import * as path from 'path';
import { AgentEvaluator } from '../src/AgentEvaluator';
import {
  BenchmarkSource,
  LoadedBenchmarkTrajectory,
  detectBenchmarkSource,
  loadBenchmarkTrajectory,
} from '../src/adapters/BenchmarkTrajectoryLoader';
import {
  ObservedBenchmarkSummaryRow,
  ObservedTrajectoryRecord,
  computeDefectFailureCorrelations,
  computeSweControlSummary,
  aggregateObservedBenchmarkSummaries,
  reportToObservedTrajectoryRecord,
} from '../src/benchmark/ObservedBenchmarkExperiments';

type BenchmarkConfig = {
  name: string;
  source: BenchmarkSource;
  input: string;
};

type FailureRow = {
  benchmark: string;
  source: BenchmarkSource;
  rawPath: string;
  error: string;
};

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

function listTrajectoryFiles(root: string, source: BenchmarkSource): string[] {
  const files: string[] = [];
  const walk = (current: string) => {
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) {
        walk(path.join(current, entry));
      }
      return;
    }

    if (source === 'swe-bench') {
      if (current.endsWith('.traj')) {
        files.push(current);
      }
      return;
    }

    if (!current.endsWith('.json')) {
      return;
    }

    const base = path.basename(current);
    if (base.startsWith('_')) {
      return;
    }
    if (source === 'android-bench' && !current.replace(/\\/g, '/').includes('/trajectories/')) {
      return;
    }
    files.push(current);
  };
  walk(root);
  return files.sort();
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function resolveConfigs(args: Record<string, string>): BenchmarkConfig[] {
  const configs: BenchmarkConfig[] = [];
  if (args['android-root']) {
    configs.push({
      name: 'android-bench',
      source: 'android-bench',
      input: path.resolve(args['android-root']),
    });
  }
  if (args['terminal-root']) {
    configs.push({
      name: 'terminal-bench',
      source: 'terminal-bench',
      input: path.resolve(args['terminal-root']),
    });
  }
  if (args['swe-root']) {
    configs.push({
      name: 'swe-bench-verified',
      source: 'swe-bench',
      input: path.resolve(args['swe-root']),
    });
  }

  if (configs.length === 0 && !args['records-input']) {
    throw new Error('Missing benchmark inputs. Use --android-root and/or --terminal-root and/or --swe-root.');
  }

  return configs;
}

function withOptionalQuiet<T>(quiet: boolean, fn: () => Promise<T>): Promise<T> {
  if (!quiet) {
    return fn();
  }

  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = () => undefined;
  console.warn = () => undefined;
  return fn().finally(() => {
    console.log = originalLog;
    console.warn = originalWarn;
  });
}

async function evaluateTrajectory(
  loaded: LoadedBenchmarkTrajectory,
  outRoot: string,
  variant: string,
  saveReports: boolean,
  quiet: boolean
): Promise<ObservedTrajectoryRecord> {
  const safeTrial = loaded.metadata.trialId || 'single';
  const targetDir = path.join(
    outRoot,
    loaded.metadata.benchmark,
    sanitize(loaded.metadata.taskId),
    sanitize(safeTrial)
  );
  ensureDir(targetDir);

  const evaluator = new AgentEvaluator(loaded.sessionData);
  let reportPath: string | undefined;
  const report = await withOptionalQuiet(quiet, async () => {
    if (!saveReports) {
      return evaluator.evaluate();
    }

    const report = await evaluator.evaluateAndSave(targetDir, ['json']);
    const reportJson = fs
      .readdirSync(targetDir)
      .find((entry) => entry.startsWith('evaluation-') && entry.endsWith('.json'));
    reportPath = reportJson ? path.join(targetDir, reportJson) : undefined;
    return report;
  });

  return reportToObservedTrajectoryRecord(loaded.metadata, report, {
    variant,
    reportPath,
  });
}

function appendJsonl(outPath: string, row: unknown) {
  fs.appendFileSync(outPath, `${JSON.stringify(row)}\n`, 'utf-8');
}

function readJsonlRecords(outPath: string): ObservedTrajectoryRecord[] {
  if (!fs.existsSync(outPath)) {
    return [];
  }
  return fs
    .readFileSync(outPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ObservedTrajectoryRecord);
}

function readMultipleJsonlRecords(pathsToRead: string[]): ObservedTrajectoryRecord[] {
  const rows: ObservedTrajectoryRecord[] = [];
  for (const inputPath of pathsToRead) {
    rows.push(...readJsonlRecords(inputPath));
  }
  return rows;
}

function readJsonlRawPaths(outPath: string): Set<string> {
  return new Set(readJsonlRecords(outPath).map((row) => row.rawPath));
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

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function maybeRunGc() {
  const gcFn = (global as typeof globalThis & { gc?: () => void }).gc;
  if (typeof gcFn === 'function') {
    gcFn();
  }
}

function writeObservedSummaryMarkdown(
  rows: ObservedBenchmarkSummaryRow[],
  outPath: string
) {
  const lines: string[] = [];
  lines.push('# Observed Offline Benchmark Summary');
  lines.push('');
  lines.push(
    'Per-source descriptive statistics over the execution trajectories evaluated in this run. ' +
      'This is an operational summary, not a ProcCtrlBench scorecard: for the paper tables and figures ' +
      '(PB / Qctx / Qtool / Qwf / Qeco / CP / fragile success) run `scripts/generate-paper-artifacts.ts` ' +
      'on `trajectory-records.jsonl`.'
  );
  lines.push('');
  lines.push('| Variant | Benchmark | N | Outcome | Outcome Rate | Mean Tokens | Mean Cost USD | Recovery After Error | Mean Risk | Mean CP | Mean Autonomy |');
  lines.push('|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|');

  for (const row of rows) {
    lines.push(
      `| ${row.variant} | ${row.benchmark} | ${row.sampleCount} | ${row.outcomeMetric} | ${formatRatio(row.outcomeRate)} | ${formatNumber(row.meanTokens)} | ${formatNumber(row.meanCostUsd)} | ${formatRatio(row.recoveryAfterErrorRate)} | ${formatNumber(row.meanOverallRisk)} | ${formatNumber(row.meanControlPreservation)} | ${formatNumber(row.meanAutonomyLevel)} |`
    );
  }

  fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
}

function writeExperimentStatusMarkdown(outPath: string, records: ObservedTrajectoryRecord[]) {
  const benchmarkNames = [...new Set(records.map((record) => record.benchmark))].sort();
  const systemNames = [...new Set(records.map((record) => record.variant))].sort();
  const withOutcome = records.filter((record) => record.success !== null).length;

  const lines: string[] = [];
  lines.push('# ProcCtrlBench Reproduction Status');
  lines.push('');
  lines.push('This file reports what the trajectories in **this** output directory can and cannot support.');
  lines.push('It is generated per run, so it always describes the data actually present.');
  lines.push('');
  lines.push('## What was evaluated here');
  lines.push('');
  lines.push(`- Trajectories: ${records.length}`);
  lines.push(`- Task sources: ${benchmarkNames.join(', ') || '(none)'}`);
  lines.push(`- Agent-model systems (\`variant\`): ${systemNames.join(', ') || '(none)'}`);
  lines.push(`- Trajectories with a recorded endpoint outcome: ${withOutcome} / ${records.length}`);
  lines.push('');
  lines.push('## Paper artifact coverage');
  lines.push('');
  lines.push(
    'Run `scripts/generate-paper-artifacts.ts` on `trajectory-records.jsonl` to build the tables and ' +
      'figures below. That script writes its own `artifact-manifest.md` stating, per artifact, whether it ' +
      'was generated or blocked and what input each blocked artifact still needs.'
  );
  lines.push('');
  lines.push('| RQ | Paper artifact | Needs | Available from this run |');
  lines.push('|---|---|---|---|');
  lines.push(
    `| RQ1 | Table 1 left: per-defect precision / recall / F1 / AP / AUROC | Process-level human annotations (\`--annotations\`) | No: this repository ships no annotation data. Detector outputs are ready; supply your own annotated set. |`
  );
  lines.push(
    `| RQ1 | Figure 2 left: defect-failure association | Endpoint outcomes only | ${withOutcome > 0 ? 'Yes' : 'No: no trajectory carries an endpoint outcome'} |`
  );
  lines.push(
    `| RQ2 | Table 1 right: ECE, hard threshold vs calibrated posterior | Human annotations | No: same annotation dependency as Table 1 left. |`
  );
  lines.push(
    `| RQ2 | Figure 7: reliability diagrams | Human annotations | No: same annotation dependency. |`
  );
  lines.push(
    `| RQ3 | Table 2: cross-system scorecard (PB, Qctx, Qtool, Qwf, Qeco, CP, fragile success) | >= 1 labelled system | ${systemNames.length >= 1 ? `Yes, for ${systemNames.length} system(s)` : 'No'} |`
  );
  lines.push(
    `| RQ3 | Table 4 / Figure 4: outcome ranking vs ProcCtrlBench ranking | Endpoint outcomes + >= 2 systems | ${withOutcome > 0 && systemNames.length >= 2 ? 'Yes' : 'Partial: needs endpoint outcomes across at least two systems'} |`
  );
  lines.push(
    `| RQ3 | Table 6 / Figure 5: bootstrap ranking stability and CIs | >= 2 systems | ${systemNames.length >= 2 ? 'Yes' : `No: only ${systemNames.length} system present; pass a distinct --variant per agent-model configuration`} |`
  );
  lines.push(
    `| RQ3 | Figure 3: per-defect system profiles | >= 1 system | ${records.length > 0 ? 'Yes' : 'No'} |`
  );
  lines.push(
    `| RQ3 | Figure 6: inter-defect correlation matrix | >= 2 trajectories | ${records.length >= 2 ? 'Yes' : 'No'} |`
  );
  lines.push(
    `| RQ4 | Table 3: scenario-specific PB per task source | Trajectories per source | ${benchmarkNames.length > 0 ? `Yes, for: ${benchmarkNames.join(', ')}` : 'No'} |`
  );
  lines.push(
    `| RQ4 | Table 7: control-preservation subdimension breakdown | >= 1 system | ${records.length > 0 ? 'Yes' : 'No'} |`
  );
  lines.push(
    `| - | Figure 8: eta sensitivity sweep | >= 1 system | ${records.length > 0 ? 'Yes' : 'No'} |`
  );
  lines.push('');
  lines.push('## How to read this');
  lines.push('');
  lines.push(
    'These outputs are real measurements over the trajectories present in this directory. The paper reports ' +
      '200 annotated cases across 11 agent-model configurations; unless this run covers that same set, the ' +
      'numbers here are a partial instantiation of the benchmark rather than a reproduction of the ' +
      'published table values. Nothing in this pipeline fabricates annotation-dependent numbers: artifacts ' +
      'without the required inputs are reported as blocked.'
  );
  lines.push('');
  lines.push('See `docs/reproducing_paper_results.md` for the full end-to-end procedure.');
  fs.writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf-8');
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(4) : '0.0000';
}

function formatRatio(value: number): string {
  return Number.isFinite(value) ? value.toFixed(4) : '0.0000';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configs = resolveConfigs(args);
  const outRoot = path.resolve(args.output || path.join(process.cwd(), 'output', 'paper-offline-experiments'));
  const variant = args.variant || 'observed-public-run';
  const quiet = args.quiet === 'true';
  const resume = args.resume !== 'false';
  const saveReports = args['save-reports'] === 'true';
  const startIndex = args['start-index'] ? Number(args['start-index']) : 0;
  const limitPerBenchmark = args['limit-per-benchmark']
    ? Number(args['limit-per-benchmark'])
    : undefined;
  const recordsInput = args['records-input']
    ? args['records-input']
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => path.resolve(value))
    : [];

  ensureDir(outRoot);

  const recordsJsonlPath = path.join(outRoot, 'trajectory-records.jsonl');
  const failuresJsonlPath = path.join(outRoot, 'trajectory-failures.jsonl');
  const completedRawPaths = resume ? readJsonlRawPaths(recordsJsonlPath) : new Set<string>();

  if (configs.length > 0) {
    for (const config of configs) {
      const files = listTrajectoryFiles(config.input, config.source)
        .filter((file) => detectBenchmarkSource(file) === config.source)
        .slice(startIndex, startIndex + (limitPerBenchmark || Number.MAX_SAFE_INTEGER));

      console.log(`Benchmark ${config.name}: ${files.length} trajectories discovered`);

      for (const file of files) {
        if (completedRawPaths.has(file)) {
          continue;
        }

        try {
          const loaded = loadBenchmarkTrajectory(file, config.source);
          console.log(`Evaluating ${loaded.metadata.benchmark}: ${loaded.metadata.taskId} / ${loaded.metadata.trialId || 'single'}`);
          const row = await evaluateTrajectory(loaded, path.join(outRoot, 'reports'), variant, saveReports, quiet);
          appendJsonl(recordsJsonlPath, row);
          completedRawPaths.add(file);
        } catch (error) {
          const failure: FailureRow = {
            benchmark: config.name,
            source: config.source,
            rawPath: file,
            error: error instanceof Error ? error.stack || error.message : String(error),
          };
          appendJsonl(failuresJsonlPath, failure);
          console.error(`Failed on ${file}: ${failure.error}`);
        } finally {
          maybeRunGc();
        }
      }
    }
  }

  const records = [
    ...readJsonlRecords(recordsJsonlPath),
    ...readMultipleJsonlRecords(recordsInput),
  ];
  const benchmarkSummary = aggregateObservedBenchmarkSummaries(records);
  const defectOverall = computeDefectFailureCorrelations(records, 'all');
  const defectByBenchmark = [...new Set(records.map((record) => record.benchmark))]
    .sort()
    .flatMap((benchmark) => computeDefectFailureCorrelations(records, benchmark));
  const sweControl = computeSweControlSummary(records);

  writeCsv(records, path.join(outRoot, 'trajectory-records.csv'));
  writeCsv(benchmarkSummary, path.join(outRoot, 'observed-benchmark-summary.csv'));
  writeCsv(defectOverall, path.join(outRoot, 'defect-failure-correlation-overall.csv'));
  writeCsv(defectByBenchmark, path.join(outRoot, 'defect-failure-correlation-by-benchmark.csv'));
  writeCsv(sweControl, path.join(outRoot, 'swe-control-preservation.csv'));
  writeObservedSummaryMarkdown(benchmarkSummary, path.join(outRoot, 'observed-benchmark-summary.md'));
  writeExperimentStatusMarkdown(path.join(outRoot, 'reproduction-status.md'), records);

  console.log(`Saved offline experiment outputs to ${outRoot}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
