import * as fs from 'fs';
import * as path from 'path';
import { ObservedTrajectoryRecord } from '../src/benchmark/ObservedBenchmarkExperiments';
import { PaperSplitName, defectRisksOfRecord, filterRecordsBySplit } from '../src/benchmark/PaperArtifacts';
import { auroc } from '../src/benchmark/PaperMetrics';
import { DEFAULT_ETA, ProcCtrlDefectKey } from '../src/benchmark/ProcCtrlScorecard';

/**
 * 论文 Table 9：简单基线与 held-out 消融。
 *
 * 输入：
 * - `--records`：当前 schema 的 trajectory-records.jsonl；
 * - `--labels`：可选的 intervention/breakdown 标签 JSON；
 * - `--split`：可选 split 文件（存在时默认只用 evaluation split）。
 *
 * 输出：
 * - `table9-baselines-ablations.csv`
 * - `table9-baselines-ablations.md`
 *
 * 无法从 record 复原的消融（例如 no-exemption 需要原始 finding 的
 * exemptionsApplied）会以 blocked 状态输出，不会伪造数值。
 */

type Args = Record<string, string>;

interface LabelSet {
  labels: Record<string, boolean>;
}

interface VariantResult {
  variant: string;
  status: 'generated' | 'blocked';
  n: number;
  auROC: number | null;
  brier: number | null;
  meanRiskScore: number | null;
  note: string;
}

const COLLAPSED_DEFECTS: ProcCtrlDefectKey[] = ['duplicateStep', 'deadStep', 'longChain'];

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

function recordKey(record: ObservedTrajectoryRecord): string {
  return record.rawPath || `${record.benchmark}/${record.taskId}/${record.trialId || 'single'}`;
}

function altKey(record: ObservedTrajectoryRecord): string {
  return `${record.benchmark}/${record.taskId}/${record.trialId || 'single'}`;
}

function loadLabels(filePath: string): LabelSet {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as
    | LabelSet
    | Record<string, boolean>
    | Array<{ caseKey: string; label: boolean }>;
  if (Array.isArray(raw)) {
    return {
      labels: Object.fromEntries(raw.map((entry) => [entry.caseKey, entry.label])),
    };
  }
  if ('labels' in raw && raw.labels) {
    return raw as LabelSet;
  }
  return { labels: raw as Record<string, boolean> };
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function riskScore(
  record: ObservedTrajectoryRecord,
  variant: string
): { score: number; probability: boolean } {
  const risks = defectRisksOfRecord(record);
  const eta = record.pbEta ?? DEFAULT_ETA;
  switch (variant) {
    case 'full':
      return { score: 1 - clamp01(record.pb), probability: true };
    case 'taxonomy_collapsed': {
      const q = 1 - mean(COLLAPSED_DEFECTS.map((key) => clamp01(risks[key] ?? 0)));
      return { score: 1 - clamp01(eta * q + (1 - eta) * record.controlPreservation), probability: true };
    }
    case 'no_calibration': {
      const triggered = [
        record.ghostContextTriggered,
        record.oversizedRulesTriggered,
        record.thrashingTriggered,
        record.duplicateStepTriggered,
        record.toolCallChainTriggered,
        record.deadStepTriggered,
        record.longChainTriggered,
        record.wrapperWorkflowTriggered,
        record.contextCouplingTriggered,
        record.inconsistentToolInterfaceTriggered,
        record.weakToolTriggered,
      ].map((value) => (value ? 1 : 0));
      const q = 1 - mean(triggered);
      return { score: 1 - clamp01(eta * q + (1 - eta) * record.controlPreservation), probability: true };
    }
    case 'no_cp':
      return { score: 1 - clamp01(record.qDef), probability: true };
    case 'cp_raw': {
      const cpRaw = typeof record.controlPreservationRaw === 'number'
        ? record.controlPreservationRaw
        : record.controlPreservation;
      return { score: 1 - clamp01(eta * record.qDef + (1 - eta) * cpRaw), probability: true };
    }
    case 'baseline_step_count':
      return { score: record.analyzedSteps, probability: false };
    case 'baseline_repeated_call_rate':
      return {
        score: (record.duplicateStepWarnings + record.duplicateStepErrors) / Math.max(record.analyzedSteps, 1),
        probability: false,
      };
    case 'baseline_token_cost':
      return {
        score: (record.tokens ?? 0) / Math.max(record.analyzedSteps, 1),
        probability: false,
      };
    default:
      return { score: 0, probability: false };
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.records) throw new Error('Missing --records');
  const records = args.records
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((filePath) => readJsonl(path.resolve(filePath)));

  let scoped = records;
  if (args.split) {
    const split = JSON.parse(fs.readFileSync(path.resolve(args.split), 'utf-8')) as {
      splitByCaseId: Record<string, PaperSplitName>;
    };
    scoped = filterRecordsBySplit(records, {
      splitByCaseId: split.splitByCaseId,
      split: 'evaluation',
    });
  }

  const labels = args.labels ? loadLabels(path.resolve(args.labels)) : undefined;
  const labelFor = (record: ObservedTrajectoryRecord): boolean | undefined => {
    if (!labels) return undefined;
    return labels.labels[recordKey(record)] ?? labels.labels[altKey(record)];
  };
  const labelled = scoped.filter((record) => typeof labelFor(record) === 'boolean');

  const variants = [
    'full',
    'taxonomy_collapsed',
    'no_exemption',
    'no_calibration',
    'no_cp',
    'cp_raw',
    'baseline_step_count',
    'baseline_repeated_call_rate',
    'baseline_token_cost',
  ];

  const results: VariantResult[] = variants.map((variant) => {
    if (variant === 'no_exemption') {
      return {
        variant,
        status: 'blocked',
        n: 0,
        auROC: null,
        brier: null,
        meanRiskScore: null,
        note:
          'Requires raw findings with exemptionsApplied; trajectory records do not preserve exempt ' +
          'detector outputs, so this ablation cannot be reconstructed honestly.',
      };
    }
    if (labelled.length === 0) {
      return {
        variant,
        status: 'blocked',
        n: 0,
        auROC: null,
        brier: null,
        meanRiskScore: null,
        note: 'No intervention/breakdown labels supplied (--labels); AUROC/Brier need a target label.',
      };
    }

    const rows = labelled.map((record) => ({
      record,
      label: labelFor(record) as boolean,
      ...riskScore(record, variant),
    }));
    const scores = rows.map((row) => row.score);
    const labelsArray = rows.map((row) => row.label);
    const probabilityRows = rows.filter((row) => row.probability);

    return {
      variant,
      status: 'generated',
      n: rows.length,
      auROC: auroc(labelsArray, scores),
      brier:
        probabilityRows.length === rows.length
          ? probabilityRows.reduce(
              (sum, row) => sum + (row.score - (row.label ? 1 : 0)) ** 2,
              0
            ) / rows.length
          : null,
      meanRiskScore: mean(scores),
      note: '',
    };
  });

  const outDir = path.resolve(args.output || 'output/paper-artifacts');
  fs.mkdirSync(outDir, { recursive: true });
  const csvPath = path.join(outDir, 'table9-baselines-ablations.csv');
  const mdPath = path.join(outDir, 'table9-baselines-ablations.md');

  const header = ['variant', 'status', 'n', 'intervention_auROC', 'brier_error', 'mean_risk_score', 'note'];
  const lines = [header.join(',')];
  const md = [
    '# Table 9: Baselines and Held-Out Ablations',
    '',
    `Records: ${scoped.length}; labelled records: ${labelled.length}.`,
    '',
    '| Variant | Status | N | Intervention AUROC | Brier | Mean risk score | Note |',
    '|---|---|---:|---:|---:|---:|---|',
  ];
  for (const result of results) {
    const cells = [
      result.variant,
      result.status,
      String(result.n),
      result.auROC === null ? '' : result.auROC.toFixed(4),
      result.brier === null ? '' : result.brier.toFixed(4),
      result.meanRiskScore === null ? '' : result.meanRiskScore.toFixed(4),
      result.note,
    ];
    lines.push(cells.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(','));
    md.push(
      `| ${result.variant} | ${result.status} | ${result.n} | ` +
        `${result.auROC === null ? '—' : result.auROC.toFixed(4)} | ` +
        `${result.brier === null ? '—' : result.brier.toFixed(4)} | ` +
        `${result.meanRiskScore === null ? '—' : result.meanRiskScore.toFixed(4)} | ${result.note} |`
    );
  }
  md.push('');
  md.push('`no_exemption` is blocked by design: the trajectory record schema does not retain exempt findings.');
  fs.writeFileSync(csvPath, `${lines.join('\n')}\n`, 'utf-8');
  fs.writeFileSync(mdPath, `${md.join('\n')}\n`, 'utf-8');

  console.log(`Wrote ablation table: ${csvPath}`);
  console.log(`Wrote ablation report: ${mdPath}`);
  for (const result of results) {
    console.log(
      `  [${result.status}] ${result.variant}` +
        (result.auROC === null ? '' : ` AUROC=${result.auROC.toFixed(3)}`) +
        (result.note ? ` — ${result.note}` : '')
    );
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}