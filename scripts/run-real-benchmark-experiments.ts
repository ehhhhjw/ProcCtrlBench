import * as fs from 'fs';
import * as path from 'path';
import { AgentEvaluator } from '../src/AgentEvaluator';
import {
  BenchmarkSource,
  LoadedBenchmarkTrajectory,
  detectBenchmarkSource,
  loadBenchmarkTrajectory,
} from '../src/adapters/BenchmarkTrajectoryLoader';

type Row = {
  benchmark: string;
  taskId: string;
  trialId: string;
  success: string;
  status: string;
  tokens: string;
  costUsd: string;
  totalWarnings: string;
  totalErrors: string;
  overallRisk: string;
  controlPreservation: string;
  autonomyLevel: string;
  reportPath: string;
  rawPath: string;
};

function parseArgs(argv: string[]) {
  const parsed: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }
    parsed[token.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  }
  return parsed;
}

function listTrajectoryFiles(root: string, source?: BenchmarkSource): string[] {
  const files: string[] = [];
  const walk = (current: string) => {
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) {
        walk(path.join(current, entry));
      }
      return;
    }

    if (source === 'swe-bench' && current.endsWith('.traj')) {
      files.push(current);
      return;
    }
    if ((source === 'android-bench' || source === 'terminal-bench') && current.endsWith('.json')) {
      const base = path.basename(current);
      if (base.startsWith('_')) {
        return;
      }
      if (source === 'android-bench' && !current.replace(/\\/g, '/').includes('/trajectories/')) {
        return;
      }
      files.push(current);
      return;
    }
    if (!source && (current.endsWith('.traj') || current.endsWith('.json'))) {
      if (path.basename(current) === '_trials.json') {
        return;
      }
      files.push(current);
    }
  };
  walk(root);
  return files.sort();
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

async function evaluateOne(
  loaded: LoadedBenchmarkTrajectory,
  outRoot: string
): Promise<Row> {
  const safeTrial = loaded.metadata.trialId || 'single';
  const targetDir = path.join(
    outRoot,
    loaded.metadata.benchmark,
    sanitize(loaded.metadata.taskId),
    sanitize(safeTrial)
  );
  ensureDir(targetDir);

  const evaluator = new AgentEvaluator(loaded.sessionData);
  const report = await evaluator.evaluateAndSave(targetDir, ['json', 'markdown']);

  const reportJson = fs
    .readdirSync(targetDir)
    .find((entry) => entry.startsWith('evaluation-') && entry.endsWith('.json'));

  return {
    benchmark: loaded.metadata.benchmark,
    taskId: loaded.metadata.taskId,
    trialId: safeTrial,
    success: stringifyMaybeBoolean(loaded.metadata.success),
    status: loaded.metadata.status || '',
    tokens: stringifyMaybeNumber(loaded.metadata.tokens),
    costUsd: stringifyMaybeNumber(loaded.metadata.costUsd),
    totalWarnings: String(report.summary.totalWarnings),
    totalErrors: String(report.summary.totalErrors),
    overallRisk: report.risk.overallRisk.toFixed(4),
    controlPreservation: report.controlPreservation.score.toFixed(4),
    autonomyLevel: report.executionGuidance.autonomyLevel.toFixed(4),
    reportPath: reportJson ? path.join(targetDir, reportJson) : targetDir,
    rawPath: loaded.metadata.rawPath,
  };
}

function writeCsv(rows: Row[], outPath: string) {
  const header = [
    'benchmark',
    'taskId',
    'trialId',
    'success',
    'status',
    'tokens',
    'costUsd',
    'totalWarnings',
    'totalErrors',
    'overallRisk',
    'controlPreservation',
    'autonomyLevel',
    'reportPath',
    'rawPath',
  ];
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      header
        .map((key) => csvEscape((row as any)[key] || ''))
        .join(',')
    );
  }
  fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args.input;
  if (!input) {
    throw new Error('Missing --input');
  }

  const source = args.source as BenchmarkSource | undefined;
  const limit = args.limit ? Number(args.limit) : undefined;
  const outRoot = path.resolve(args.output || path.join(process.cwd(), 'output', 'real-benchmarks'));
  ensureDir(outRoot);

  const files = listTrajectoryFiles(path.resolve(input), source)
    .filter((file) => (source ? detectBenchmarkSource(file) === source : true))
    .slice(0, limit || Number.MAX_SAFE_INTEGER);

  console.log(`Found ${files.length} trajectory files`);

  const rows: Row[] = [];
  for (const file of files) {
    const loaded = loadBenchmarkTrajectory(file, source);
    console.log(`Evaluating ${loaded.metadata.benchmark}: ${loaded.metadata.taskId}${loaded.metadata.trialId ? ` / ${loaded.metadata.trialId}` : ''}`);
    rows.push(await evaluateOne(loaded, outRoot));
  }

  const csvPath = path.join(outRoot, 'summary.csv');
  writeCsv(rows, csvPath);
  console.log(`Saved summary CSV to ${csvPath}`);
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function stringifyMaybeBoolean(value?: boolean): string {
  return typeof value === 'boolean' ? String(value) : '';
}

function stringifyMaybeNumber(value?: number): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
