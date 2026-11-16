import * as fs from 'fs';
import * as path from 'path';
import { EvaluationReport } from '../types/evaluation.types';
import { cohensD } from './Stats';

/**
 * BenchmarkRunner: aggregates evaluation results across multiple trials and reports means with
 * bootstrap confidence intervals.
 */
export class BenchmarkRunner {
  private reports: EvaluationReport[] = [];

  constructor(private inputDir: string) {}

  load(): void {
    if (!fs.existsSync(this.inputDir)) throw new Error(`Input dir not found: ${this.inputDir}`);
    const files = fs.readdirSync(this.inputDir).filter(f => f.startsWith('evaluation-') && f.endsWith('.json'));
    this.reports = files.map(f => JSON.parse(fs.readFileSync(path.join(this.inputDir, f), 'utf-8')) as EvaluationReport);
    if (this.reports.length === 0) throw new Error('No evaluation JSON found.');
  }

  /**
   * Simple bootstrap confidence interval (mean, 95% CI).
   */
  private bootstrapMeanCI(values: number[], B = 2000, alpha = 0.05): { mean: number; lo: number; hi: number } {
    const n = values.length;
    const mean = values.reduce((a, b) => a + b, 0) / Math.max(n, 1);
    if (n === 0) return { mean: 0, lo: 0, hi: 0 };
    const samples: number[] = [];
    for (let b = 0; b < B; b++) {
      let s = 0;
      for (let i = 0; i < n; i++) {
        s += values[Math.floor(Math.random() * n)];
      }
      samples.push(s / n);
    }
    samples.sort((a, b) => a - b);
    const lo = samples[Math.floor(B * (alpha / 2))];
    const hi = samples[Math.floor(B * (1 - alpha / 2))];
    return { mean, lo, hi };
  }

  private aggregateDimensionCount(
    name: keyof EvaluationReport['dimensions'],
    field: 'warnings' | 'errors'
  ) {
    const values = this.reports.map(r => r.dimensions[name][field]);
    return this.bootstrapMeanCI(values);
  }

  private aggregateContextMetric(
    selector: (report: EvaluationReport) => number | undefined
  ): { mean: number; lo: number; hi: number } | null {
    const values = this.reports
      .map(selector)
      .filter((value): value is number => typeof value === 'number' && !Number.isNaN(value));

    if (values.length === 0) {
      return null;
    }

    return this.bootstrapMeanCI(values);
  }

  private pushMetricLine(
    lines: string[],
    label: string,
    metric: { mean: number; lo: number; hi: number } | null
  ): void {
    if (!metric) {
      return;
    }
    lines.push(`- ${label}: ${metric.mean.toFixed(2)} (95% CI [${metric.lo.toFixed(2)}, ${metric.hi.toFixed(2)}])`);
  }

  /**
   * Export a brief Markdown report.
   */
  saveMarkdown(outPath: string): void {
    const lines: string[] = [];
    lines.push('# Benchmark Summary');
    lines.push(`Sample count: ${this.reports.length}`);
    lines.push('');

    const dims: Array<keyof EvaluationReport['dimensions']> = [
      'taskOutcome',
      'contextManagement',
      'toolUseEfficiency',
      'workflowArchitecture',
      'toolEcosystemConsistency',
    ];
    lines.push('| Dimension | Mean Warnings | Warnings 95% CI | Mean Errors | Errors 95% CI |');
    lines.push('|---|---|---|---|---|');
    for (const d of dims) {
      const warnings = this.aggregateDimensionCount(d, 'warnings');
      const errors = this.aggregateDimensionCount(d, 'errors');
      lines.push(`| ${d} | ${warnings.mean.toFixed(2)} | [${warnings.lo.toFixed(2)}, ${warnings.hi.toFixed(2)}] | ${errors.mean.toFixed(2)} | [${errors.lo.toFixed(2)}, ${errors.hi.toFixed(2)}] |`);
    }

    const analyzedSteps = this.aggregateContextMetric((report) => report.analysis?.contextChains?.analyzedSteps);
    const averageChainLength = this.aggregateContextMetric((report) => report.analysis?.contextChains?.averageChainLength);
    const maxChainLength = this.aggregateContextMetric((report) => report.analysis?.contextChains?.maxChainLength);

    if (analyzedSteps || averageChainLength || maxChainLength) {
      lines.push('');
      lines.push('## Context Chain Analysis Summary');
      this.pushMetricLine(lines, 'Mean analyzed steps', analyzedSteps);
      this.pushMetricLine(lines, 'Mean context chain length', averageChainLength);
      this.pushMetricLine(lines, 'Mean maximum chain length', maxChainLength);
    }

    lines.push('');
    lines.push('## Process Risk and Control Preservation');
    this.pushMetricLine(lines, 'overallRisk', this.aggregateContextMetric(report => report.risk?.overallRisk));
    this.pushMetricLine(lines, 'averagePosteriorRisk', this.aggregateContextMetric(report => report.risk?.averagePosteriorRisk));
    this.pushMetricLine(lines, 'expectedCalibrationError', this.aggregateContextMetric(report => report.risk?.calibration.expectedCalibrationError));
    this.pushMetricLine(lines, 'brierScore', this.aggregateContextMetric(report => report.risk?.calibration.brierScore));
    this.pushMetricLine(lines, 'controlPreservation', this.aggregateContextMetric(report => report.controlPreservation?.score));
    this.pushMetricLine(lines, 'autonomyLevel', this.aggregateContextMetric(report => report.executionGuidance?.autonomyLevel));

    lines.push('');
    lines.push('## Task Outcome Quality');
    this.pushMetricLine(
      lines,
      'taskCompletionRate',
      this.aggregateContextMetric(report => report.dimensions.taskOutcome.details.taskCompletionRate)
    );
    this.pushMetricLine(
      lines,
      'outputExecutability',
      this.aggregateContextMetric(report => report.dimensions.taskOutcome.details.outputExecutability)
    );
    this.pushMetricLine(
      lines,
      'postModificationVerificationRate',
      this.aggregateContextMetric(report => report.dimensions.taskOutcome.details.postModificationVerificationRate)
    );

    lines.push('');
    lines.push('## Risk Dimension Summary');
    this.pushMetricLine(
      lines,
      'Context Management avg posterior',
      this.aggregateContextMetric(report => report.risk?.dimensions.contextManagement.averagePosteriorRisk)
    );
    this.pushMetricLine(
      lines,
      'Tool Use Efficiency avg posterior',
      this.aggregateContextMetric(report => report.risk?.dimensions.toolUseEfficiency.averagePosteriorRisk)
    );
    this.pushMetricLine(
      lines,
      'Workflow Architecture avg posterior',
      this.aggregateContextMetric(report => report.risk?.dimensions.workflowArchitecture.averagePosteriorRisk)
    );
    this.pushMetricLine(
      lines,
      'Tool Ecosystem avg posterior',
      this.aggregateContextMetric(report => report.risk?.dimensions.toolEcosystemConsistency.averagePosteriorRisk)
    );

    // Simple effect size example: compare against the first report (if another group exists)
    if (this.reports.length >= 2) {
      lines.push('');
      lines.push('## Effect Size (example, comparing the first two groups)');
      const a = this.reports[0];
      const b = this.reports[1];
      const dims2: Array<keyof EvaluationReport['dimensions']> = dims;
      lines.push('| Dimension | Warnings Cohen d | Errors Cohen d |');
      lines.push('|---|---|---|');
      for (const d of dims2) {
        const warningD = cohensD([a.dimensions[d].warnings], [b.dimensions[d].warnings]);
        const errorD = cohensD([a.dimensions[d].errors], [b.dimensions[d].errors]);
        lines.push(`| ${d} | ${warningD.toFixed(3)} | ${errorD.toFixed(3)} |`);
      }
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
  }
}

// Executable entry point: aggregate from the default output directory and generate markdown
if (require.main === module) {
  const inputDir = process.argv[2] || path.join(process.cwd(), 'output/evaluation-reports');
  const outPath = process.argv[3] || path.join(process.cwd(), 'output/benchmark/summary.md');
  const runner = new BenchmarkRunner(inputDir);
  runner.load();
  runner.saveMarkdown(outPath);
  console.log(`Saved benchmark summary to ${outPath}`);
}
