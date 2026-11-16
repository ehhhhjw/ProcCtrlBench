import * as fs from 'fs';
import * as path from 'path';
import { pearson } from '../src/benchmark/Stats';
import { auroc } from '../src/benchmark/PaperMetrics';

/**
 * 论文 Table 11：主动干预验证分析。
 *
 * 输入 JSON（由干预实验产生）：
 * {
 *   "rows": [
 *     {
 *       "runId": "...",
 *       "predictors": {
 *         "interruptibility": 0.71,
 *         "correctability": 0.68,
 *         "reversibility": 0.74,
 *         "authorityHandoff": 0.66
 *       },
 *       "outcomes": {
 *         "cleanPause": true,
 *         "localRepair": true,
 *         "exactRestore": false,
 *         "continuationSuccess": true
 *       }
 *     }
 *   ]
 * }
 *
 * 论文协议：在 t = floor(0.5n) 处冻结 predictor，再注入干预并记录 outcome。
 * 本脚本只做统计，不执行干预；没有数据时输出 template + blocked 报告。
 */

type Args = Record<string, string>;

interface InterventionRow {
  runId: string;
  predictors: Record<string, number>;
  outcomes: Record<string, boolean>;
}

interface InterventionDataset {
  rows: InterventionRow[];
  schemaVersion?: string;
  protocol?: string;
}

const PREDICTOR_TO_OUTCOME: Record<string, string> = {
  interruptibility: 'cleanPause',
  correctability: 'localRepair',
  reversibility: 'exactRestore',
  authorityHandoff: 'continuationSuccess',
};

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

/** Fisher z 近似：z = atanh(r) * sqrt(n - 3)，双侧 p 值。 */
function correlationPValue(r: number, n: number): number {
  if (n <= 3 || !Number.isFinite(r)) return 1;
  const clamped = Math.min(0.999999, Math.max(-0.999999, r));
  const z = Math.atanh(clamped) * Math.sqrt(n - 3);
  return 2 * (1 - normalCdf(Math.abs(z)));
}

function normalCdf(value: number): number {
  // Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + 0.2316419 * Math.abs(value));
  const d = 0.3989423 * Math.exp((-value * value) / 2);
  const prob =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return value >= 0 ? 1 - prob : prob;
}

function writeTemplate(outDir: string): string {
  const templatePath = path.join(outDir, 'table11-intervention-template.json');
  fs.writeFileSync(
    templatePath,
    `${JSON.stringify(
      {
        schemaVersion: 'procctrlbench-intervention-v1',
        protocol:
          'Freeze predictors on T_{1:t-1} at t=floor(0.5n); inject intervention at t; record outcomes ' +
          'on T_{t:n}. 44 runs are required by the paper.',
        rows: [
          {
            runId: 'run-001',
            predictors: {
              interruptibility: 0,
              correctability: 0,
              reversibility: 0,
              authorityHandoff: 0,
            },
            outcomes: {
              cleanPause: false,
              localRepair: false,
              exactRestore: false,
              continuationSuccess: false,
            },
          },
        ],
      },
      null,
      2
    )}\n`,
    'utf-8'
  );
  return templatePath;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(args.output || 'output/paper-artifacts');
  fs.mkdirSync(outDir, { recursive: true });

  const inputPath = args.input ? path.resolve(args.input) : undefined;
  if (!inputPath) {
    const templatePath = writeTemplate(outDir);
    console.log(`No --input supplied; wrote intervention template: ${templatePath}`);
    console.log('Table 11 is blocked until real intervention outcomes are supplied.');
    return;
  }

  const dataset = JSON.parse(fs.readFileSync(inputPath, 'utf-8')) as InterventionDataset;
  const rows = (dataset.rows || []).filter(
    (row) =>
      Number.isFinite(row.predictors?.interruptibility) ||
      Number.isFinite(row.predictors?.correctability) ||
      Number.isFinite(row.predictors?.reversibility) ||
      Number.isFinite(row.predictors?.authorityHandoff)
  );
  if (rows.length === 0) {
    throw new Error(`No usable intervention rows in ${inputPath}`);
  }

  const results = Object.entries(PREDICTOR_TO_OUTCOME).map(([predictor, outcome]) => {
    const scoped = rows.filter(
      (row) =>
        Number.isFinite(row.predictors?.[predictor]) &&
        typeof row.outcomes?.[outcome] === 'boolean'
    );
    const x = scoped.map((row) => row.predictors[predictor]);
    const y = scoped.map((row) => (row.outcomes[outcome] ? 1 : 0));
    const r = scoped.length >= 2 ? pearson(x, y) : 0;
    return {
      predictor,
      outcome,
      n: scoped.length,
      pearsonR: r,
      pValue: correlationPValue(r, scoped.length),
      auROC: scoped.length >= 2 ? auroc(y.map((value) => value === 1), x) : 0,
    };
  });

  const csvPath = path.join(outDir, 'table11-intervention-validation.csv');
  const mdPath = path.join(outDir, 'table11-intervention-validation.md');
  const header = ['predictor', 'outcome', 'n', 'pearson_r', 'p_value', 'auROC'];
  const lines = [header.join(',')];
  const md = [
    '# Table 11: Active Intervention Validation',
    '',
    `Input: ${inputPath}`,
    '',
    '| Predictor | Outcome | N | Pearson r | p-value | AUROC |',
    '|---|---|---:|---:|---:|---:|',
  ];
  for (const result of results) {
    lines.push(
      [result.predictor, result.outcome, String(result.n), result.pearsonR.toFixed(4), result.pValue.toExponential(3), result.auROC.toFixed(4)].join(',')
    );
    md.push(
      `| ${result.predictor} | ${result.outcome} | ${result.n} | ${result.pearsonR.toFixed(3)} | ` +
        `${result.pValue.toExponential(2)} | ${result.auROC.toFixed(3)} |`
    );
  }
  md.push('');
  md.push('p-values use the Fisher z approximation; the paper reports p < 0.001 for all four predictors.');
  fs.writeFileSync(csvPath, `${lines.join('\n')}\n`, 'utf-8');
  fs.writeFileSync(mdPath, `${md.join('\n')}\n`, 'utf-8');

  console.log(`Wrote intervention table: ${csvPath}`);
  console.log(`Wrote intervention report: ${mdPath}`);
  for (const result of results) {
    console.log(
      `  ${result.predictor.padEnd(18)} n=${result.n} r=${result.pearsonR.toFixed(3)} ` +
        `p=${result.pValue.toExponential(2)} AUROC=${result.auROC.toFixed(3)}`
    );
  }
  if (rows.length < 44) {
    console.warn(`WARNING: paper uses 44 intervention runs; this input has ${rows.length}.`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}