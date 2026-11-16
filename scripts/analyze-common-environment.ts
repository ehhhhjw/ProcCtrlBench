import * as fs from 'fs';
import * as path from 'path';
import { ObservedTrajectoryRecord } from '../src/benchmark/ObservedBenchmarkExperiments';
import {
  PaperSplitName,
  buildTable15,
  filterRecordsBySplit,
} from '../src/benchmark/PaperArtifacts';
import { DEFAULT_ETA } from '../src/benchmark/ProcCtrlScorecard';

/**
 * 论文 Table 15：Qpolicy / Qinfra 去混淆与共同环境消融。
 *
 * - Qpolicy / Qinfra 直接从 11 类风险计算；
 * - task-matched pass rate 只使用所有系统共同覆盖的 task；
 * - commonEnvPB 需要记录标记 commonEnvironment=true，或通过
 *   --common-env-harness / --common-env-systems 指定共同环境。
 *
 * 用法：
 *   npx ts-node scripts/analyze-common-environment.ts \
 *     --records output/runs/<system>/trajectory-records.jsonl \
 *     --split output/paper-corpus/paper-corpus-split.json \
 *     --common-env-harness opencode \
 *     --output output/paper-artifacts
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.records) throw new Error('Missing --records');
  const records = args.records
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((filePath) => readJsonl(path.resolve(filePath)));

  let splitByCaseId: Record<string, PaperSplitName> | undefined;
  if (args.split) {
    const raw = JSON.parse(fs.readFileSync(path.resolve(args.split), 'utf-8')) as {
      splitByCaseId: Record<string, PaperSplitName>;
    };
    splitByCaseId = raw.splitByCaseId;
  }

  const commonEnvHarness = args['common-env-harness'];
  const commonEnvSystems = args['common-env-systems']
    ? args['common-env-systems'].split(',').map((value) => value.trim())
    : [];
  let marked = 0;
  for (const record of records) {
    if (record.commonEnvironment === true) continue;
    const inferredHarness =
      record.harness ?? (record.variant.includes('/') ? record.variant.split('/')[0].trim() : undefined);
    if (
      (commonEnvHarness && inferredHarness && inferredHarness.toLowerCase().includes(commonEnvHarness.toLowerCase())) ||
      commonEnvSystems.includes(record.variant)
    ) {
      record.commonEnvironment = true;
      marked++;
    }
  }

  const heldOutRecords = splitByCaseId
    ? filterRecordsBySplit(records, { splitByCaseId, split: 'evaluation' })
    : records;
  const artifact = buildTable15(heldOutRecords, {
    eta: args.eta ? Number(args.eta) : DEFAULT_ETA,
    splitByCaseId,
    split: splitByCaseId ? 'evaluation' : undefined,
  });

  const outDir = path.resolve(args.output || 'output/paper-artifacts');
  fs.mkdirSync(outDir, { recursive: true });
  const csvPath = path.join(outDir, 'table15-policy-infra.csv');
  const mdPath = path.join(outDir, 'table15-policy-infra.md');

  if (artifact.status === 'blocked') {
    fs.writeFileSync(mdPath, `# Table 15: Policy / Infrastructure Deconfounding\n\nBLOCKED: ${artifact.reason}\n`, 'utf-8');
    console.log(`Table 15 blocked: ${artifact.reason}`);
    return;
  }

  const header = [
    'system',
    'taskMatchedPassRate',
    'heldOutPB',
    'qPolicy',
    'qInfra',
    'commonEnvPB',
    'sampleCount',
    'matchedTaskCount',
  ];
  const lines = [header.join(',')];
  const md = [
    '# Table 15: Policy / Infrastructure Deconfounding',
    '',
    `Records: ${heldOutRecords.length}; common-environment records marked: ${marked}.`,
    '',
    '| System | Task-matched pass | Held-out PB | Qpolicy | Qinfra | Common-env PB | N | Matched tasks |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const row of artifact.rows) {
    lines.push(
      [
        row.system,
        row.taskMatchedPassRate === null ? '' : row.taskMatchedPassRate.toFixed(4),
        row.heldOutPB.toFixed(4),
        row.qPolicy.toFixed(4),
        row.qInfra.toFixed(4),
        row.commonEnvPB === null ? '' : row.commonEnvPB.toFixed(4),
        String(row.sampleCount),
        String(row.matchedTaskCount),
      ]
        .map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell))
        .join(',')
    );
    md.push(
      `| ${row.system} | ${row.taskMatchedPassRate === null ? '—' : row.taskMatchedPassRate.toFixed(3)} | ` +
        `${row.heldOutPB.toFixed(3)} | ${row.qPolicy.toFixed(3)} | ${row.qInfra.toFixed(3)} | ` +
        `${row.commonEnvPB === null ? '—' : row.commonEnvPB.toFixed(3)} | ${row.sampleCount} | ${row.matchedTaskCount} |`
    );
  }
  md.push('');
  if (artifact.rows.every((row) => row.commonEnvPB === null)) {
    md.push(
      'Common-environment PB is missing: no record is marked `commonEnvironment=true`. ' +
        'Run the 4-model OpenCode ablation first, then pass --common-env-harness.'
    );
  }
  if (artifact.rows.some((row) => row.matchedTaskCount === 0)) {
    md.push('Task-matched pass rate is missing for at least one system because no common task exists across systems.');
  }
  fs.writeFileSync(csvPath, `${lines.join('\n')}\n`, 'utf-8');
  fs.writeFileSync(mdPath, `${md.join('\n')}\n`, 'utf-8');

  console.log(`Wrote Table 15: ${csvPath}`);
  console.log(`Wrote Table 15 report: ${mdPath}`);
  for (const row of artifact.rows) {
    console.log(
      `  ${row.system.padEnd(32)} PB=${row.heldOutPB.toFixed(3)} ` +
        `Qpolicy=${row.qPolicy.toFixed(3)} Qinfra=${row.qInfra.toFixed(3)} ` +
        `commonEnv=${row.commonEnvPB === null ? '—' : row.commonEnvPB.toFixed(3)}`
    );
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}