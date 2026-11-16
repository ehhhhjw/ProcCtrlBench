import * as fs from 'fs';
import * as path from 'path';
import { ObservedTrajectoryRecord } from '../src/benchmark/ObservedBenchmarkExperiments';
import { PaperSplitName, filterRecordsBySplit } from '../src/benchmark/PaperArtifacts';
import { bootstrapCI, createSeededRng, wilcoxonSignedRank } from '../src/benchmark/Stats';

/**
 * 论文 v8 的 task-grouped paired 比较：
 * - 先按 task 聚合每个系统的 PB；
 * - 只在两系统共同覆盖的 task 上配对；
 * - 报告 paired Wilcoxon signed-rank p 值；
 * - 对 task 做 paired bootstrap，给出均值差的 95% CI。
 *
 * 论文使用 10,000 次 task-grouped paired bootstrap；本脚本默认也是 10,000。
 *
 * 用法：
 *   npx ts-node scripts/paired-system-tests.ts \
 *     --records output/runs/.../trajectory-records.jsonl \
 *     --split output/paper-corpus/paper-corpus-split.json \
 *     --output output/paper-artifacts \
 *     --replicates 10000
 */

type Args = Record<string, string>;

function parseArgs(argv: string[]): Args {
  const parsed: Args = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    parsed[token.slice(2)] =
      argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : 'true';
  }
  return parsed;
}

function readJsonl(filePath: string): ObservedTrajectoryRecord[] {
  return fs
    .readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ObservedTrajectoryRecord);
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.records) throw new Error('Missing --records');
  let records = args.records
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((filePath) => readJsonl(path.resolve(filePath)));

  if (args.split) {
    const split = JSON.parse(fs.readFileSync(path.resolve(args.split), 'utf-8')) as {
      splitByCaseId: Record<string, PaperSplitName>;
    };
    records = filterRecordsBySplit(records, {
      splitByCaseId: split.splitByCaseId,
      split: 'evaluation',
    });
  }

  // system -> taskKey -> PB values
  const bySystemTask = new Map<string, Map<string, number[]>>();
  for (const record of records) {
    const taskKey = `${record.benchmark}/${record.taskId}`;
    const system = record.variant;
    let byTask = bySystemTask.get(system);
    if (!byTask) {
      byTask = new Map();
      bySystemTask.set(system, byTask);
    }
    const bucket = byTask.get(taskKey) ?? [];
    bucket.push(record.pb);
    byTask.set(taskKey, bucket);
  }

  const systems = [...bySystemTask.keys()].sort();
  const replicates = args.replicates ? Number(args.replicates) : 10000;
  const seed = args.seed ? Number(args.seed) : 20270101;
  const rng = createSeededRng(seed);

  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < systems.length; i++) {
    for (let j = i + 1; j < systems.length; j++) {
      const left = systems[i];
      const right = systems[j];
      const leftTasks = bySystemTask.get(left)!;
      const rightTasks = bySystemTask.get(right)!;
      const common = [...leftTasks.keys()].filter((task) => rightTasks.has(task)).sort();
      const leftScores = common.map((task) => mean(leftTasks.get(task)!));
      const rightScores = common.map((task) => mean(rightTasks.get(task)!));
      if (common.length < 2) {
        rows.push({
          systemA: left,
          systemB: right,
          nTasks: common.length,
          meanDifference: '',
          medianDifference: '',
          wilcoxonStatistic: '',
          pValue: '',
          ciLow: '',
          ciHigh: '',
          significantAt001: '',
          note: 'fewer than 2 common tasks',
        });
        continue;
      }

      const diffs = leftScores.map((score, index) => score - rightScores[index]);
      const wilcoxon = wilcoxonSignedRank(leftScores, rightScores);
      const ci = bootstrapCI(diffs, replicates, 0.05, rng);

      rows.push({
        systemA: left,
        systemB: right,
        nTasks: common.length,
        meanDifference: wilcoxon.meanDifference,
        medianDifference: wilcoxon.medianDifference,
        wilcoxonStatistic: wilcoxon.statistic,
        pValue: wilcoxon.pValue,
        ciLow: ci.lo,
        ciHigh: ci.hi,
        significantAt001: wilcoxon.pValue < 0.01,
        note: '',
      });
    }
  }

  const outDir = path.resolve(args.output || 'output/paper-artifacts');
  fs.mkdirSync(outDir, { recursive: true });
  const csvPath = path.join(outDir, 'paired-system-tests.csv');
  const mdPath = path.join(outDir, 'paired-system-tests.md');

  const header = [
    'systemA',
    'systemB',
    'nTasks',
    'meanDifference',
    'medianDifference',
    'wilcoxonStatistic',
    'pValue',
    'ciLow',
    'ciHigh',
    'significantAt001',
    'note',
  ];
  const lines = [header.join(',')];
  const md = [
    '# Task-Grouped Paired System Tests',
    '',
    `Held-out records: ${records.length}; systems: ${systems.length}; bootstrap replicates: ${replicates}.`,
    '',
    '| System A | System B | N tasks | Mean diff | Median diff | Wilcoxon W | p | 95% CI | p<0.01 |',
    '|---|---|---:|---:|---:|---:|---:|---|---|',
  ];
  for (const row of rows) {
    const cells = header.map((key) => {
      const value = row[key];
      return typeof value === 'number' ? String(Number(value.toFixed(6))) : String(value ?? '');
    });
    lines.push(cells.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(','));
    const fmt = (value: unknown) =>
      typeof value === 'number' ? value.toFixed(4) : String(value ?? '—');
    md.push(
      `| ${row.systemA} | ${row.systemB} | ${row.nTasks} | ${fmt(row.meanDifference)} | ` +
        `${fmt(row.medianDifference)} | ${fmt(row.wilcoxonStatistic)} | ${fmt(row.pValue)} | ` +
        `[${fmt(row.ciLow)}, ${fmt(row.ciHigh)}] | ${row.significantAt001} |`
    );
  }
  md.push('');
  md.push(
    'Bootstrap resamples tasks (paired), matching the paper\'s task-grouped paired bootstrap. ' +
      'Wilcoxon p-values use the normal approximation.'
  );
  fs.writeFileSync(csvPath, `${lines.join('\n')}\n`, 'utf-8');
  fs.writeFileSync(mdPath, `${md.join('\n')}\n`, 'utf-8');

  console.log(`Wrote paired tests: ${csvPath}`);
  console.log(`Wrote paired test report: ${mdPath}`);
  for (const row of rows) {
    console.log(
      `  ${row.systemA} vs ${row.systemB}: n=${row.nTasks} ` +
        `diff=${typeof row.meanDifference === 'number' ? row.meanDifference.toFixed(4) : '—'} ` +
        `p=${typeof row.pValue === 'number' ? row.pValue.toExponential(2) : '—'}`
    );
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}