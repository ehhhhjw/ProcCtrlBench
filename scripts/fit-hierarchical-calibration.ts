import * as fs from 'fs';
import * as path from 'path';
import {
  flattenAnnotationSet,
  loadAnnotationSet,
} from '../src/adapters/AnnotationLoader';
import {
  CalibrationSample,
  fitHierarchicalCalibration,
  validateCalibrationProfile,
} from '../src/benchmark/HierarchicalCalibration';
import { ObservedTrajectoryRecord } from '../src/benchmark/ObservedBenchmarkExperiments';
import { ProcCtrlDefectKey } from '../src/benchmark/ProcCtrlScorecard';

/**
 * 在 development / calibration split 上拟合论文 v8 的层次贝叶斯校准参数。
 *
 * 前置输入：
 * 1. `--records`：当前 schema 的 trajectory-records.jsonl（含 defectSignals）；
 * 2. `--annotations`：procctrlbench-annotation-v1 标注集；
 * 3. `--split`：export-annotation-split.ts 生成的 splitByCaseId。
 *
 * 用法：
 *   npx ts-node scripts/fit-hierarchical-calibration.ts \
 *     --records output/runs/<system>/trajectory-records.jsonl \
 *     --annotations output/annotations/annotations.json \
 *     --split output/annotations/split.json \
 *     --output output/calibration/hierarchical.json
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

function recordCaseKey(record: ObservedTrajectoryRecord): string {
  return record.rawPath || `${record.benchmark}/${record.taskId}/${record.trialId || 'single'}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const required of ['records', 'annotations', 'split']) {
    if (!args[required]) {
      throw new Error(`Missing --${required}`);
    }
  }

  const recordPaths = args.records
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => path.resolve(value));
  const records = recordPaths.flatMap(readJsonl);

  const recordByKey = new Map<string, ObservedTrajectoryRecord>();
  for (const record of records) {
    recordByKey.set(recordCaseKey(record), record);
    recordByKey.set(`${record.benchmark}/${record.taskId}/${record.trialId || 'single'}`, record);
  }

  const annotationPath = path.resolve(args.annotations);
  const loaded = loadAnnotationSet(annotationPath);
  if (loaded.errors.length > 0) {
    console.error(`Annotation set has ${loaded.errors.length} blocking issue(s):`);
    for (const issue of loaded.errors.slice(0, 20)) {
      console.error(`  - [${issue.caseId}${issue.defect ? `/${issue.defect}` : ''}] ${issue.message}`);
    }
    throw new Error('Refusing to fit calibration on an invalid annotation set.');
  }

  const splitPath = path.resolve(args.split);
  const split = JSON.parse(fs.readFileSync(splitPath, 'utf-8')) as {
    splitByCaseId: Record<string, 'development' | 'calibration' | 'evaluation'>;
  };

  const rows = flattenAnnotationSet(loaded.set);
  const devSamples: CalibrationSample[] = [];
  const calSamples: CalibrationSample[] = [];
  let unmatched = 0;
  let missingSignals = 0;

  for (const row of rows) {
    const splitName = split.splitByCaseId[row.caseId];
    if (splitName !== 'development' && splitName !== 'calibration') continue;

    const record = recordByKey.get(row.rawPath || '') ?? recordByKey.get(row.caseId);
    if (!record) {
      unmatched++;
      continue;
    }
    const signal = record.defectSignals?.[row.defect as ProcCtrlDefectKey];
    if (typeof signal !== 'number') {
      missingSignals++;
    }
    const sample: CalibrationSample = {
      defect: row.defect,
      benchmark: row.benchmark,
      signal: typeof signal === 'number' ? signal : 0,
      label: row.label,
      exempt: row.exempt,
    };
    if (splitName === 'development') devSamples.push(sample);
    else calSamples.push(sample);
  }

  if (devSamples.length === 0 || calSamples.length === 0) {
    throw new Error(
      `Insufficient calibration data: dev=${devSamples.length}, cal=${calSamples.length}. ` +
        'Check that the split JSON and annotation caseIds match the evaluated records.'
    );
  }

  const profile = fitHierarchicalCalibration(devSamples, calSamples, {
    seed: args.seed ? Number(args.seed) : 20270101,
    iterations: args.iterations ? Number(args.iterations) : undefined,
    learningRate: args['learning-rate'] ? Number(args['learning-rate']) : undefined,
    empiricalBayesIterations: args['empirical-bayes-iterations']
      ? Number(args['empirical-bayes-iterations'])
      : undefined,
  });

  const errors = validateCalibrationProfile(profile);
  if (errors.length > 0) {
    throw new Error(`Fitted profile failed validation: ${errors.join('; ')}`);
  }

  profile.createdAt = new Date().toISOString();
  const outPath = path.resolve(args.output || 'output/calibration/hierarchical.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(profile, null, 2)}\n`, 'utf-8');

  console.log(`Wrote hierarchical calibration profile: ${outPath}`);
  console.log(
    `Training rows — dev: ${devSamples.length}, cal: ${calSamples.length}, ` +
      `positives in cal: ${profile.training.calPositives}`
  );
  if (unmatched > 0) console.warn(`WARNING: ${unmatched} annotation row(s) matched no trajectory.`);
  if (missingSignals > 0) {
    console.warn(
      `WARNING: ${missingSignals} row(s) had no defectSignals; signal defaulted to 0. ` +
        'Re-run scripts/run-paper-offline-experiments.ts with the current schema.'
    );
  }
  for (const defect of Object.values(profile.defects)) {
    console.log(
      `  ${defect.defect.padEnd(28)} alpha=${defect.alpha.toFixed(3)} ` +
        `beta=${defect.beta.toFixed(3)} support=${defect.support} positives=${defect.positives}`
    );
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}