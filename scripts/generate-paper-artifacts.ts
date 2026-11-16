import * as fs from 'fs';
import * as path from 'path';
import { flattenAnnotationSet, loadAnnotationSet } from '../src/adapters/AnnotationLoader';
import { ObservedTrajectoryRecord } from '../src/benchmark/ObservedBenchmarkExperiments';
import {
  AnyArtifactOutcome,
  PaperArtifactBundle,
  PaperSplitName,
  buildAllPaperArtifacts,
  filterAnnotationRowsBySplit,
  filterRecordsBySplit,
} from '../src/benchmark/PaperArtifacts';
import {
  DEFAULT_ETA,
  DEFAULT_ERROR_BAND_THRESHOLD,
  DEFAULT_FRAGILE_PB_THRESHOLD,
  DEFAULT_MIN_ERROR_DEFECTS,
} from '../src/benchmark/ProcCtrlScorecard';

/**
 * 生成 ProcCtrlBench 论文的表格与图表数据。
 *
 * 用法：
 *   npx ts-node scripts/generate-paper-artifacts.ts \
 *     --records output/run-a/trajectory-records.jsonl,output/run-b/trajectory-records.jsonl \
 *     --annotations path/to/annotations.json \
 *     --output output/paper-artifacts
 *
 * --records 可传多个 JSONL，每个文件里的 variant 字段作为 agent-model 系统标识。
 * --annotations 可选；缺失时依赖人工标注的产出会被明确标记为 blocked，而不是
 * 输出空表或占位数字。
 */

type Args = Record<string, string>;

function parseArgs(argv: string[]): Args {
  const parsed: Args = {};
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

function readRecordsJsonl(filePath: string): ObservedTrajectoryRecord[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Trajectory records not found: ${filePath}`);
  }
  return fs
    .readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line, lineIndex) => {
      try {
        return JSON.parse(line) as ObservedTrajectoryRecord;
      } catch (error) {
        throw new Error(
          `Malformed JSON on line ${lineIndex + 1} of ${filePath}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    });
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
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function writeCsv(rows: object[], outPath: string) {
  if (rows.length === 0) {
    return;
  }
  const header = Object.keys(rows[0] as Record<string, unknown>);
  const lines = [header.join(',')];
  for (const row of rows) {
    const record = row as Record<string, unknown>;
    lines.push(header.map((key) => csvEscape(toCell(record[key]))).join(','));
  }
  fs.writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf-8');
}

function writeManifest(
  bundle: PaperArtifactBundle,
  outDir: string,
  context: {
    eta: number;
    seed: number;
    replicates: number;
    fragilePbThreshold: number;
    errorBandThreshold: number;
    minErrorDefects: number;
    annotationPath?: string;
    splitPath?: string;
    splitFilter?: PaperSplitName;
  }
) {
  const generatedArtifacts = bundle.artifacts.filter((artifact) => artifact.status === 'generated');
  const blockedArtifacts = bundle.artifacts.filter((artifact) => artifact.status === 'blocked');

  const lines: string[] = [];
  lines.push('# ProcCtrlBench Paper Artifacts');
  lines.push('');
  lines.push('## Inputs');
  lines.push('');
  lines.push(`- Trajectory records: ${bundle.recordCount}`);
  lines.push(`- Agent-model systems: ${bundle.systemCount}`);
  lines.push(`- Task sources: ${bundle.benchmarks.join(', ') || '(none)'}`);
  lines.push(`- Annotation rows: ${bundle.annotationRowCount}${context.annotationPath ? ` (from ${context.annotationPath})` : ' (no annotation set supplied)'}`);
  lines.push('');
  lines.push('## Scoring configuration');
  lines.push('');
  lines.push(`- eta (paper v8, 3.5): ${context.eta}`);
  lines.push(
    `- fragile success: PB < ${context.fragilePbThreshold} OR >= ${context.minErrorDefects} defects with p_j >= ${context.errorBandThreshold}`
  );
  lines.push(`- bootstrap replicates: ${context.replicates}, seed: ${context.seed}`);
  if (context.splitPath) {
    lines.push(
      `- split assignment: ${context.splitPath}${context.splitFilter ? ` (filter: ${context.splitFilter})` : ''}`
    );
  } else {
    lines.push('- split assignment: (none supplied; held-out tables fall back to all records)');
  }
  lines.push('');
  lines.push(
    'eta = 0.70 and the fragile-success thresholds are the paper v8 definitions. ' +
      'Figure 8 reports the full sensitivity sweep over eta.'
  );
  lines.push('');
  lines.push(`## Generated (${generatedArtifacts.length})`);
  lines.push('');
  lines.push('| Paper reference | Artifact | Rows | File |');
  lines.push('|---|---|---:|---|');
  for (const artifact of generatedArtifacts) {
    lines.push(
      `| ${artifact.paperRef} | ${artifact.id} | ${artifact.rows.length} | \`${artifact.id}.csv\` |`
    );
  }

  lines.push('');
  lines.push(`## Blocked (${blockedArtifacts.length})`);
  lines.push('');
  if (blockedArtifacts.length === 0) {
    lines.push('None: every artifact had sufficient input data.');
  } else {
    lines.push('| Paper reference | Artifact | Missing input |');
    lines.push('|---|---|---|');
    for (const artifact of blockedArtifacts) {
      lines.push(`| ${artifact.paperRef} | ${artifact.id} | ${artifact.reason} |`);
    }
  }

  const withCaveats = generatedArtifacts.filter((artifact) => artifact.reason);
  if (withCaveats.length > 0) {
    lines.push('');
    lines.push('## Caveats on generated artifacts');
    lines.push('');
    for (const artifact of withCaveats) {
      lines.push(`- **${artifact.id}**: ${artifact.reason}`);
    }
  }

  fs.writeFileSync(path.join(outDir, 'artifact-manifest.md'), `${lines.join('\n')}\n`, 'utf-8');
}

function summarize(artifacts: AnyArtifactOutcome[]) {
  for (const artifact of artifacts) {
    if (artifact.status === 'generated') {
      const caveat = artifact.reason ? ` (note: ${artifact.reason})` : '';
      console.log(`  [ok]      ${artifact.paperRef} -> ${artifact.id}.csv (${artifact.rows.length} rows)${caveat}`);
    } else {
      console.log(`  [blocked] ${artifact.paperRef} -> ${artifact.id}: ${artifact.reason}`);
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.records) {
    throw new Error(
      'Missing --records. Pass one or more trajectory-records.jsonl paths, comma separated.\n' +
        'Produce them first with scripts/run-paper-offline-experiments.ts.'
    );
  }

  const recordPaths = args.records
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => path.resolve(value));

  const records = recordPaths.flatMap(readRecordsJsonl);
  if (records.length === 0) {
    throw new Error(`No trajectory records were read from: ${recordPaths.join(', ')}`);
  }

  const legacyRecords = records.filter((record) => typeof record.pb !== 'number');
  if (legacyRecords.length > 0) {
    throw new Error(
      `${legacyRecords.length} of ${records.length} records predate the ProcCtrlBench scorecard fields ` +
        '(pb / qDef / per-defect posterior risk). Re-run scripts/run-paper-offline-experiments.ts to ' +
        'regenerate trajectory-records.jsonl with the current schema.'
    );
  }

  let annotationRows: ReturnType<typeof flattenAnnotationSet> = [];
  const annotationPath = args.annotations ? path.resolve(args.annotations) : undefined;
  if (annotationPath) {
    const loaded = loadAnnotationSet(annotationPath);
    if (loaded.errors.length > 0) {
      console.error(`Annotation set has ${loaded.errors.length} blocking issue(s):`);
      for (const issue of loaded.errors.slice(0, 20)) {
        console.error(`  - [${issue.caseId}${issue.defect ? `/${issue.defect}` : ''}] ${issue.message}`);
      }
      throw new Error('Refusing to build annotation-dependent artifacts from an invalid annotation set.');
    }
    if (loaded.warnings.length > 0) {
      console.warn(`Annotation set has ${loaded.warnings.length} non-blocking warning(s); continuing.`);
    }
    annotationRows = flattenAnnotationSet(loaded.set);
    console.log(`Loaded ${loaded.caseCount} annotated cases -> ${annotationRows.length} case-defect rows`);
  }

  const eta = args.eta ? Number(args.eta) : DEFAULT_ETA;
  if (!Number.isFinite(eta) || eta < 0 || eta > 1) {
    throw new Error(`--eta must be a number in [0, 1], got "${args.eta}"`);
  }
  const seed = args.seed ? Number(args.seed) : 20270101;
  const replicates = args.replicates ? Number(args.replicates) : 10000;

  const fragilePbThreshold = args['fragile-pb-threshold']
    ? Number(args['fragile-pb-threshold'])
    : DEFAULT_FRAGILE_PB_THRESHOLD;
  const errorBandThreshold = args['error-band-threshold']
    ? Number(args['error-band-threshold'])
    : DEFAULT_ERROR_BAND_THRESHOLD;
  const minErrorDefects = args['min-error-defects']
    ? Number(args['min-error-defects'])
    : DEFAULT_MIN_ERROR_DEFECTS;
  if (!Number.isFinite(fragilePbThreshold) || fragilePbThreshold < 0 || fragilePbThreshold > 1) {
    throw new Error(`--fragile-pb-threshold must be a number in [0, 1]`);
  }
  if (!Number.isFinite(errorBandThreshold) || errorBandThreshold < 0 || errorBandThreshold > 1) {
    throw new Error(`--error-band-threshold must be a number in [0, 1]`);
  }
  if (!Number.isFinite(minErrorDefects) || minErrorDefects < 1) {
    throw new Error(`--min-error-defects must be a positive integer`);
  }

  let splitByCaseId: Record<string, PaperSplitName> | undefined;
  const splitPath = args.split ? path.resolve(args.split) : undefined;
  if (splitPath) {
    const raw = JSON.parse(fs.readFileSync(splitPath, 'utf-8')) as {
      splitByCaseId?: Record<string, PaperSplitName>;
      assignments?: Array<{ caseId: string; split: PaperSplitName }>;
    };
    splitByCaseId =
      raw.splitByCaseId ??
      Object.fromEntries((raw.assignments ?? []).map((entry) => [entry.caseId, entry.split]));
    console.log(`Loaded split assignment: ${splitPath}`);
  }
  const splitFilter = args['split-filter'] as PaperSplitName | undefined;
  if (splitFilter && !['development', 'calibration', 'evaluation'].includes(splitFilter)) {
    throw new Error(`--split-filter must be development / calibration / evaluation`);
  }

  const outDir = path.resolve(args.output || path.join(process.cwd(), 'output', 'paper-artifacts'));
  fs.mkdirSync(outDir, { recursive: true });

  const devOptions = { splitByCaseId, split: 'development' as const };
  const devRecords = splitByCaseId ? filterRecordsBySplit(records, devOptions) : [];
  const devAnnotationRows = splitByCaseId
    ? filterAnnotationRowsBySplit(annotationRows, devOptions)
    : [];

  const bundle = buildAllPaperArtifacts(records, annotationRows, {
    eta,
    seed,
    replicates,
    fragilePbThreshold,
    errorBandThreshold,
    minErrorDefects,
    splitByCaseId,
    split: splitFilter,
    devRecords,
    devAnnotationRows,
  });

  console.log(
    `\nBuilding paper artifacts from ${bundle.recordCount} trajectories across ` +
      `${bundle.systemCount} system(s) and ${bundle.benchmarks.length} task source(s):\n`
  );
  summarize(bundle.artifacts);

  for (const artifact of bundle.artifacts) {
    if (artifact.status === 'generated') {
      writeCsv(artifact.rows, path.join(outDir, `${artifact.id}.csv`));
    }
  }
  writeManifest(bundle, outDir, {
    eta,
    seed,
    replicates,
    fragilePbThreshold,
    errorBandThreshold,
    minErrorDefects,
    annotationPath,
    splitPath,
    splitFilter,
  });

  const blockedCount = bundle.artifacts.filter((artifact) => artifact.status === 'blocked').length;
  console.log(`\nWrote ${bundle.artifacts.length - blockedCount} artifact file(s) to ${outDir}`);
  console.log(`See ${path.join(outDir, 'artifact-manifest.md')} for the full coverage report.`);
  if (blockedCount > 0) {
    console.log(
      `\n${blockedCount} artifact(s) were blocked by missing input data; the manifest lists what each one needs.`
    );
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
