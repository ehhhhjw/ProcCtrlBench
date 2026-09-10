import * as fs from 'fs';
import * as path from 'path';
import { EvaluationReport } from '../types/evaluation.types';
import { cohensD } from './Stats';

/**
 * BenchmarkRunner: 聚合多次试验的评测结果，输出均值与Bootstrap置信区间。
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
   * 简单Bootstrap置信区间（均值，95% CI）。
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
   * 导出简要Markdown报告。
   */
  saveMarkdown(outPath: string): void {
    const lines: string[] = [];
    lines.push('# Benchmark 汇总');
    lines.push(`样本数: ${this.reports.length}`);
    lines.push('');

    const dims: Array<keyof EvaluationReport['dimensions']> = [
      'taskOutcome',
      'contextManagement',
      'toolUseEfficiency',
      'workflowArchitecture',
      'toolEcosystemConsistency',
    ];
    lines.push('| 维度 | 平均告警 | 告警95%CI | 平均错误 | 错误95%CI |');
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
      lines.push('## 上下文链分析汇总');
      this.pushMetricLine(lines, '平均分析步数', analyzedSteps);
      this.pushMetricLine(lines, '平均上下文链长度', averageChainLength);
      this.pushMetricLine(lines, '平均最大链长度', maxChainLength);
    }

    lines.push('');
    lines.push('## 过程风险与控制保持');
    this.pushMetricLine(lines, 'overallRisk', this.aggregateContextMetric(report => report.risk?.overallRisk));
    this.pushMetricLine(lines, 'averagePosteriorRisk', this.aggregateContextMetric(report => report.risk?.averagePosteriorRisk));
    this.pushMetricLine(lines, 'expectedCalibrationError', this.aggregateContextMetric(report => report.risk?.calibration.expectedCalibrationError));
    this.pushMetricLine(lines, 'brierScore', this.aggregateContextMetric(report => report.risk?.calibration.brierScore));
    this.pushMetricLine(lines, 'controlPreservation', this.aggregateContextMetric(report => report.controlPreservation?.score));
    this.pushMetricLine(lines, 'autonomyLevel', this.aggregateContextMetric(report => report.executionGuidance?.autonomyLevel));

    lines.push('');
    lines.push('## 任务结果质量');
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
    lines.push('## 风险维度摘要');
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

    // 简单效应量示例：与第一份报告进行比较（若存在另一组）
    if (this.reports.length >= 2) {
      lines.push('');
      lines.push('## 效应量（示例，对比前两组）');
      const a = this.reports[0];
      const b = this.reports[1];
      const dims2: Array<keyof EvaluationReport['dimensions']> = dims;
      lines.push('| 维度 | 告警 Cohen d | 错误 Cohen d |');
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

// 可执行入口：从默认输出目录聚合并生成markdown
if (require.main === module) {
  const inputDir = process.argv[2] || path.join(process.cwd(), 'output/evaluation-reports');
  const outPath = process.argv[3] || path.join(process.cwd(), 'output/benchmark/summary.md');
  const runner = new BenchmarkRunner(inputDir);
  runner.load();
  runner.saveMarkdown(outPath);
  console.log(`Saved benchmark summary to ${outPath}`);
}
