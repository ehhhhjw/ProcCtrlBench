import * as fs from 'fs';
import * as path from 'path';
import { loadAnnotationSet, AnnotatedCase } from '../src/adapters/AnnotationLoader';
import {
  PAPER_SPLIT_SIZES,
  SplitName,
  splitAnnotatedCases,
} from '../src/benchmark/AnnotationSplit';

/**
 * 导出论文 v8 附录 B.4 的 80/40/80 分层划分。
 *
 * 划分只依赖标注集与 seed；输出 JSON 供 fit-hierarchical-calibration、
 * generate-paper-artifacts 等下游脚本使用，避免每个脚本各自重算。
 *
 * 用法：
 *   npx ts-node scripts/export-annotation-split.ts \
 *     --annotations path/to/annotations.json \
 *     --output output/annotations/split.json \
 *     --seed 20270101
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

function parseSizes(args: Args): Partial<Record<SplitName, number>> | undefined {
  if (!args.development && !args.calibration && !args.evaluation) return undefined;
  return {
    development: args.development ? Number(args.development) : PAPER_SPLIT_SIZES.development,
    calibration: args.calibration ? Number(args.calibration) : PAPER_SPLIT_SIZES.calibration,
    evaluation: args.evaluation ? Number(args.evaluation) : PAPER_SPLIT_SIZES.evaluation,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.annotations) {
    throw new Error('Missing --annotations path/to/annotations.json');
  }
  const annotationsPath = path.resolve(args.annotations);
  const loaded = loadAnnotationSet(annotationsPath);
  if (loaded.errors.length > 0) {
    console.error(`Annotation set has ${loaded.errors.length} blocking issue(s):`);
    for (const issue of loaded.errors.slice(0, 20)) {
      console.error(`  - [${issue.caseId}${issue.defect ? `/${issue.defect}` : ''}] ${issue.message}`);
    }
    throw new Error('Refusing to split an invalid annotation set.');
  }

  const seed = args.seed ? Number(args.seed) : 20270101;
  const sizes = parseSizes(args);
  const result = splitAnnotatedCases(loaded.set.cases, { seed, sizes });

  // 任务级检查：同一 taskId 不得跨 split。
  const taskSplits = new Map<string, Set<SplitName>>();
  for (const annotatedCase of loaded.set.cases) {
    const assignment = result.splitByCaseId[annotatedCase.caseId];
    if (!assignment) continue;
    const key = `${annotatedCase.benchmark}/${annotatedCase.taskId}`;
    const bucket = taskSplits.get(key) ?? new Set<SplitName>();
    bucket.add(assignment);
    taskSplits.set(key, bucket);
  }
  const leakedTasks = [...taskSplits.entries()]
    .filter(([, splits]) => splits.size > 1)
    .map(([task]) => task);
  const violations: string[] = leakedTasks.map(
    (task) => `task crosses splits: ${task}`
  );

  const outPath = path.resolve(args.output || 'output/annotations/split.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        schemaVersion: 'procctrlbench-split-v1',
        source: annotationsPath,
        seed,
        sizes: result.counts,
        targetSizes: sizes ?? PAPER_SPLIT_SIZES,
        assignments: result.assignments,
        splitByCaseId: result.splitByCaseId,
        counts: result.counts,
        stratumCounts: result.stratumCounts,
        notes: result.notes,
        taskLevelLeaks: leakedTasks,
        splitDisciplineViolations: violations,
      },
      null,
      2
    )}\n`,
    'utf-8'
  );

  console.log(`Wrote split assignment: ${outPath}`);
  console.log(
    `Counts — development: ${result.counts.development}, calibration: ${result.counts.calibration}, ` +
      `evaluation: ${result.counts.evaluation}`
  );
  for (const note of result.notes) {
    console.warn(`NOTE: ${note}`);
  }
  if (leakedTasks.length > 0) {
    console.warn(`WARNING: ${leakedTasks.length} task(s) cross splits: ${leakedTasks.slice(0, 10).join(', ')}`);
  }
  if (violations.length > 0) {
    console.warn(`WARNING: split discipline violations: ${violations.length}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}