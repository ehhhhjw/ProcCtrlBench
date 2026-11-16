import * as fs from 'fs';
import * as path from 'path';
import { ObservedTrajectoryRecord } from '../src/benchmark/ObservedBenchmarkExperiments';
import { PaperSplitName } from '../src/benchmark/PaperArtifacts';
import { createSeededRng } from '../src/benchmark/Stats';

/**
 * 按论文 v8 Table 5 的组成采样 11 系统 / 50 任务 / 200 轨迹语料。
 *
 * 重要：本脚本**不会伪造**轨迹。它只从已有 records 中选择匹配任务，
 * 输出 selected JSONL 与 gap report；缺失的系统/来源/轨迹数会明确列出。
 *
 * 用法：
 *   npx ts-node scripts/sample-paper-corpus.ts \
 *     --records output/runs/.../trajectory-records.jsonl \
 *     --config config/paper-systems.json \
 *     --output output/paper-corpus \
 *     --seed 20270101
 */

type Args = Record<string, string>;

interface PaperSystem {
  name: string;
  family: string;
  model: string;
  counts: Record<string, { total: number; heldOut: number }>;
  total: number;
  heldOut: number;
}

interface PaperSystemsConfig {
  taskSources: Record<string, { tasks: number; heldOutTasks: number; trajectories: number; heldOut: number }>;
  splitTaskRatios: Record<PaperSplitName, number>;
  systems: PaperSystem[];
}

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

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim();
}

function shuffle<T>(values: T[], rng: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(rng() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function allocateTasks(
  tasks: string[],
  config: PaperSystemsConfig,
  rng: () => number
): Record<PaperSplitName, string[]> {
  const ratios = config.splitTaskRatios;
  const totalRatio = ratios.development + ratios.calibration + ratios.evaluation;
  const ordered = shuffle(tasks, rng);
  const devCount = Math.round((ordered.length * ratios.development) / totalRatio);
  const calCount = Math.round((ordered.length * ratios.calibration) / totalRatio);
  return {
    development: ordered.slice(0, devCount),
    calibration: ordered.slice(devCount, devCount + calCount),
    evaluation: ordered.slice(devCount + calCount),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.records) throw new Error('Missing --records');
  const configPath = path.resolve(args.config || 'config/paper-systems.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as PaperSystemsConfig;
  const seed = args.seed ? Number(args.seed) : 20270101;
  const rng = createSeededRng(seed);

  const recordPaths = args.records
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => path.resolve(value));
  const records = recordPaths.flatMap(readJsonl);

  const variantMap: Record<string, string> = args['variant-map']
    ? JSON.parse(fs.readFileSync(path.resolve(args['variant-map']), 'utf-8'))
    : {};
  const expectedByName = new Map(config.systems.map((system) => [normalize(system.name), system]));

  function resolveSystem(variant: string): PaperSystem | undefined {
    const mapped = variantMap[variant];
    if (mapped) return expectedByName.get(normalize(mapped));
    return expectedByName.get(normalize(variant));
  }

  const matched: Array<{ record: ObservedTrajectoryRecord; system: PaperSystem }> = [];
  for (const record of records) {
    const system = resolveSystem(record.variant);
    if (system) matched.push({ record, system });
  }

  const presentSystems = [...new Set(matched.map((entry) => entry.system.name))].sort();
  const missingSystems = config.systems
    .map((system) => system.name)
    .filter((name) => !presentSystems.includes(name));

  // benchmark -> system -> task -> records
  const index = new Map<string, Map<string, Map<string, ObservedTrajectoryRecord[]>>>();
  for (const { record, system } of matched) {
    const bySystem = index.get(record.benchmark) ?? new Map();
    index.set(record.benchmark, bySystem);
    const byTask = bySystem.get(system.name) ?? new Map();
    bySystem.set(system.name, byTask);
    const bucket = byTask.get(record.taskId) ?? [];
    bucket.push(record);
    byTask.set(record.taskId, bucket);
  }

  const selected: ObservedTrajectoryRecord[] = [];
  const splitAssignments: Record<string, PaperSplitName> = {};
  const gaps: Array<{ system: string; benchmark: string; kind: string; target: number; actual: number }> = [];
  const taskSplitByBenchmark: Record<string, Record<PaperSplitName, string[]>> = {};

  for (const benchmark of Object.keys(config.taskSources)) {
    const source = config.taskSources[benchmark];
    const bySystem = index.get(benchmark) ?? new Map();

    // 只考虑所有 present systems 都覆盖的任务，保证 task-matched。
    const taskSets = presentSystems
      .map((system) => {
        const byTask = bySystem.get(system);
        return byTask ? [...byTask.keys()] : [];
      })
      .map((keys) => new Set(keys));
    const commonTasks =
      taskSets.length === 0
        ? []
        : [...taskSets[0]].filter((task) => taskSets.every((set) => set.has(task))).sort();
    const selectedTasks = commonTasks.slice(0, source.tasks);
    while (selectedTasks.length < source.tasks) {
      selectedTasks.push(`__MISSING_TASK_${selectedTasks.length + 1}__`);
    }
    const assignment = allocateTasks(selectedTasks, config, rng);
    taskSplitByBenchmark[benchmark] = assignment;

    if (commonTasks.length < source.tasks) {
      gaps.push({
        system: '(all)',
        benchmark,
        kind: 'task-intersection',
        target: source.tasks,
        actual: commonTasks.length,
      });
    }

    for (const system of config.systems) {
      const target = system.counts[benchmark];
      if (!target) continue;
      const byTask = bySystem.get(system.name);
      if (!byTask) {
        gaps.push({ system: system.name, benchmark, kind: 'missing-system', target: target.total, actual: 0 });
        continue;
      }

      const heldOutTasks = assignment.evaluation.filter((task) => !task.startsWith('__MISSING'));
      const otherTasks = [
        ...assignment.development,
        ...assignment.calibration,
      ].filter((task) => !task.startsWith('__MISSING'));

      const pick = (tasks: string[], limit: number): ObservedTrajectoryRecord[] => {
        const candidates = tasks.flatMap((task) =>
          (byTask.get(task) ?? []).slice().sort((left, right) => left.rawPath.localeCompare(right.rawPath))
        );
        return candidates.slice(0, limit);
      };

      const heldOut = pick(heldOutTasks, target.heldOut);
      const remaining = target.total - heldOut.length;
      const rest = pick(otherTasks, remaining);
      const scoped = [...heldOut, ...rest];

      if (scoped.length < target.total) {
        gaps.push({
          system: system.name,
          benchmark,
          kind: 'trajectory-count',
          target: target.total,
          actual: scoped.length,
        });
      }

      for (const record of scoped) {
        selected.push(record);
        const split: PaperSplitName = heldOut.includes(record)
          ? 'evaluation'
          : assignment.development.includes(record.taskId)
            ? 'development'
            : 'calibration';
        splitAssignments[`${record.benchmark}/${record.taskId}/${record.trialId || 'single'}`] = split;
        splitAssignments[record.rawPath] = split;
      }
    }
  }

  const outDir = path.resolve(args.output || 'output/paper-corpus');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'paper-corpus-selection.jsonl'),
    `${selected.map((record) => JSON.stringify(record)).join('\n')}\n`,
    'utf-8'
  );

  const perSystem = config.systems.map((system) => {
    const scoped = selected.filter((record) => resolveSystem(record.variant)?.name === system.name);
    return {
      system: system.name,
      target: system.total,
      selected: scoped.length,
      targetHeldOut: system.heldOut,
      selectedHeldOut: scoped.filter(
        (record) => splitAssignments[record.rawPath] === 'evaluation'
      ).length,
      byBenchmark: Object.fromEntries(
        Object.keys(config.taskSources).map((benchmark) => [
          benchmark,
          scoped.filter((record) => record.benchmark === benchmark).length,
        ])
      ),
    };
  });

  const totalTarget = config.systems.reduce((sum, system) => sum + system.total, 0);
  const complete =
    missingSystems.length === 0 &&
    gaps.length === 0 &&
    selected.length === totalTarget;

  const manifest = {
    schemaVersion: 'procctrlbench-corpus-manifest-v1',
    status: complete ? 'complete' : 'partial',
    seed,
    sourceRecords: records.length,
    matchedRecords: matched.length,
    selectedRecords: selected.length,
    targetRecords: totalTarget,
    expectedSystems: config.systems.length,
    presentSystems: presentSystems.length,
    missingSystems,
    gaps,
    perSystem,
    tasks: taskSplitByBenchmark,
    notes: [
      'This manifest only selects existing records; it never fabricates trajectories.',
      'A partial manifest means the paper Table 5 composition is not yet available.',
    ],
  };
  fs.writeFileSync(
    path.join(outDir, 'paper-corpus-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf-8'
  );
  fs.writeFileSync(
    path.join(outDir, 'paper-corpus-split.json'),
    `${JSON.stringify(
      {
        schemaVersion: 'procctrlbench-split-v1',
        source: path.join(outDir, 'paper-corpus-selection.jsonl'),
        seed,
        counts: {
          development: selected.filter((record) => splitAssignments[record.rawPath] === 'development').length,
          calibration: selected.filter((record) => splitAssignments[record.rawPath] === 'calibration').length,
          evaluation: selected.filter((record) => splitAssignments[record.rawPath] === 'evaluation').length,
        },
        splitByCaseId: splitAssignments,
        taskSplits: taskSplitByBenchmark,
        notes: manifest.notes,
      },
      null,
      2
    )}\n`,
    'utf-8'
  );
  fs.writeFileSync(
    path.join(outDir, 'paper-corpus-gaps.md'),
    [
      '# Paper Corpus Gap Report',
      '',
      `Status: **${manifest.status}**`,
      '',
      `- Target: ${totalTarget} trajectories across ${config.systems.length} systems.`,
      `- Selected: ${selected.length} trajectories across ${presentSystems.length} systems.`,
      `- Missing systems: ${missingSystems.length > 0 ? missingSystems.join(', ') : '(none)'}`,
      '',
      '## Gaps',
      '',
      gaps.length === 0
        ? 'None.'
        : [
            '| System | Benchmark | Gap | Target | Actual |',
            '|---|---|---|---:|---:|',
            ...gaps.map(
              (gap) => `| ${gap.system} | ${gap.benchmark} | ${gap.kind} | ${gap.target} | ${gap.actual} |`
            ),
          ].join('\n'),
      '',
      'A partial corpus is reported honestly; do not use it to claim reproduction of Table 5.',
      '',
    ].join('\n'),
    'utf-8'
  );

  console.log(`Wrote paper corpus selection: ${path.join(outDir, 'paper-corpus-selection.jsonl')}`);
  console.log(`Wrote manifest: ${path.join(outDir, 'paper-corpus-manifest.json')}`);
  console.log(`Wrote split: ${path.join(outDir, 'paper-corpus-split.json')}`);
  console.log(`Wrote gap report: ${path.join(outDir, 'paper-corpus-gaps.md')}`);
  console.log(
    `Status: ${manifest.status} — selected ${selected.length}/${totalTarget} trajectories, ` +
      `${presentSystems.length}/${config.systems.length} systems.`
  );
  if (missingSystems.length > 0) {
    console.warn(`Missing systems: ${missingSystems.join(', ')}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}