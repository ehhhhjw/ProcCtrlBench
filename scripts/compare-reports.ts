import * as fs from 'fs';
import * as path from 'path';
import { bootstrapCI, cohensD } from '../src/benchmark/Stats';
import { EvaluationReport } from '../src/types/evaluation.types';

function readReports(dir: string): EvaluationReport[] {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  return files.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as EvaluationReport);
}

type MetricSelector = {
  label: string;
  select: (report: EvaluationReport) => number | undefined;
};

function pickMetric(reports: EvaluationReport[], selector: MetricSelector['select']): number[] {
  return reports
    .map(selector)
    .filter((value): value is number => typeof value === 'number' && !Number.isNaN(value));
}

function main() {
  const beforeDir = process.argv[2] || path.join(process.cwd(), 'output', 'evaluation-reports', 'before');
  const afterDir = process.argv[3] || path.join(process.cwd(), 'output', 'evaluation-reports', 'after');
  const outPath = process.argv[4] || path.join(process.cwd(), 'output', 'benchmark', 'compare-summary.md');

  if (!fs.existsSync(beforeDir) || !fs.existsSync(afterDir)) {
    console.error('Missing before/after dirs:', beforeDir, afterDir);
    process.exit(1);
  }
  const before = readReports(beforeDir);
  const after = readReports(afterDir);
  if (before.length === 0 || after.length === 0) {
    console.error('Empty before/after report sets');
    process.exit(1);
  }

  const metrics: MetricSelector[] = [
    {
      label: 'overallRisk',
      select: (report) => report.risk?.overallRisk,
    },
    {
      label: 'controlPreservation',
      select: (report) => report.controlPreservation?.score,
    },
    {
      label: 'autonomyLevel',
      select: (report) => report.executionGuidance?.autonomyLevel,
    },
    {
      label: 'taskCompletionRate',
      select: (report) => report.dimensions.taskOutcome.details.taskCompletionRate,
    },
    {
      label: 'outputExecutability',
      select: (report) => report.dimensions.taskOutcome.details.outputExecutability,
    },
    {
      label: 'postModificationVerificationRate',
      select: (report) => report.dimensions.taskOutcome.details.postModificationVerificationRate,
    },
    {
      label: 'expectedCalibrationError',
      select: (report) => report.risk?.calibration.expectedCalibrationError,
    },
    {
      label: 'brierScore',
      select: (report) => report.risk?.calibration.brierScore,
    },
    {
      label: 'contextManagement.avgPosteriorRisk',
      select: (report) => report.risk?.dimensions.contextManagement.averagePosteriorRisk,
    },
    {
      label: 'toolUseEfficiency.avgPosteriorRisk',
      select: (report) => report.risk?.dimensions.toolUseEfficiency.averagePosteriorRisk,
    },
    {
      label: 'workflowArchitecture.avgPosteriorRisk',
      select: (report) => report.risk?.dimensions.workflowArchitecture.averagePosteriorRisk,
    },
    {
      label: 'toolEcosystemConsistency.avgPosteriorRisk',
      select: (report) => report.risk?.dimensions.toolEcosystemConsistency.averagePosteriorRisk,
    },
  ];

  const lines: string[] = [];
  lines.push('# Comparison Summary');
  lines.push(`Sample size: before=${before.length}, after=${after.length}`);
  lines.push('');
  lines.push('| Metric | before mean [95% CI] | after mean [95% CI] | Cohen d |');
  lines.push('|---|---|---|---|');
  for (const metric of metrics) {
    const bvals = pickMetric(before, metric.select);
    const avals = pickMetric(after, metric.select);
    if (bvals.length === 0 || avals.length === 0) {
      continue;
    }
    const bci = bootstrapCI(bvals);
    const aci = bootstrapCI(avals);
    const dval = cohensD(bvals, avals);
    lines.push(`| ${metric.label} | ${bci.mean.toFixed(2)} [${bci.lo.toFixed(2)}, ${bci.hi.toFixed(2)}] | ${aci.mean.toFixed(2)} [${aci.lo.toFixed(2)}, ${aci.hi.toFixed(2)}] | ${dval.toFixed(3)} |`);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
  console.log('Saved compare summary to', outPath);
}

main();
