import * as fs from 'fs';
import * as path from 'path';

/**
 * 导出论文 v8 Table 3 的可执行检测器规格。
 *
 * 表本身是论文附录 A 的固定规格；本脚本把 config/paper-detector-specs.json
 * 与仓库中的 detector 文件对应起来，并报告哪些实现只是近似。
 *
 * 用法：
 *   npx ts-node scripts/export-detector-specs.ts \
 *     --config config/paper-detector-specs.json \
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

interface DetectorSpec {
  defect: string;
  abbreviation: string;
  dimension: string;
  scoreFormula: string;
  threshold: number;
  exemption: string;
  codeMapping: string;
  fidelity: string;
}

function csvEscape(value: unknown): string {
  const text = value === null || typeof value === 'undefined' ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(rows: DetectorSpec[], outPath: string): void {
  const header = ['defect', 'abbreviation', 'dimension', 'scoreFormula', 'threshold', 'exemption', 'codeMapping', 'fidelity'];
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(header.map((key) => csvEscape((row as unknown as Record<string, unknown>)[key])).join(','));
  }
  fs.writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf-8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = path.resolve(args.config || 'config/paper-detector-specs.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
    schemaVersion: string;
    source: string;
    note: string;
    detectors: DetectorSpec[];
  };

  const outDir = path.resolve(args.output || 'output/paper-artifacts');
  fs.mkdirSync(outDir, { recursive: true });
  const csvPath = path.join(outDir, 'table3-detector-specs.csv');
  const mdPath = path.join(outDir, 'table3-detector-specs.md');
  writeCsv(config.detectors, csvPath);

  const missing = config.detectors
    .map((spec) => spec.codeMapping)
    .filter((file) => !fs.existsSync(path.resolve(file)));

  const lines: string[] = [];
  lines.push('# Table 3: Executable Detector Specifications');
  lines.push('');
  lines.push(`Source: ${config.source}`);
  lines.push('');
  lines.push(`> ${config.note}`);
  lines.push('');
  lines.push('| Defect | Abbrev. | Dimension | Score formula | tau_j | Exemption | Code mapping | Fidelity |');
  lines.push('|---|---|---|---|---:|---|---|---|');
  for (const spec of config.detectors) {
    lines.push(
      `| ${spec.defect} | ${spec.abbreviation} | ${spec.dimension} | \`${spec.scoreFormula}\` | ` +
        `${spec.threshold} | ${spec.exemption} | \`${spec.codeMapping}\` | ${spec.fidelity} |`
    );
  }
  lines.push('');
  lines.push('## Implementation fidelity');
  lines.push('');
  lines.push(
    '`approximate` means the repository detector emits deterministic rule-based evidence for the same ' +
      'defect, but does not currently implement the literal continuous formula in the paper table. ' +
      'A strict reproduction should port the formula and re-tune tau_j on the 80 development trajectories.'
  );
  lines.push('');
  if (missing.length > 0) {
    lines.push(`Missing code mapping files: ${missing.join(', ')}`);
  } else {
    lines.push('All code mapping files exist.');
  }
  fs.writeFileSync(mdPath, `${lines.join('\n')}\n`, 'utf-8');

  console.log(`Wrote detector specification table: ${csvPath}`);
  console.log(`Wrote detector specification report: ${mdPath}`);
  if (missing.length > 0) {
    console.warn(`WARNING: ${missing.length} code mapping file(s) missing: ${missing.join(', ')}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}