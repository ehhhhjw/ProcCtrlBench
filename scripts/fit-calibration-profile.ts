import * as fs from 'fs';
import * as path from 'path';
import {
  fitCalibrationProfile,
  loadReportsFromDirectory,
} from '../src/benchmark/CalibrationFitter';
import { DEFAULT_EVALUATION_CONFIG } from '../src/config/evaluation.config';

function getArgValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1 || index === args.length - 1) {
    return undefined;
  }
  return args[index + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function main() {
  const args = process.argv.slice(2);
  const inputDir = getArgValue(args, '--input')
    || path.join(process.cwd(), 'output', 'evaluation-reports');
  const outputPath = getArgValue(args, '--output')
    || path.join(process.cwd(), 'output', 'calibration', 'detector-profile.json');
  const labelMode = (getArgValue(args, '--label-mode') || 'severity-error') as 'severity-error' | 'risk-error';
  const shrinkage = Number(getArgValue(args, '--shrinkage') || 6);
  const bucketCount = Number(getArgValue(args, '--bucket-count') || DEFAULT_EVALUATION_CONFIG.riskModel.calibrationBucketCount);
  const minMetricSamples = Number(getArgValue(args, '--min-metric-samples') || 2);

  if (!fs.existsSync(inputDir)) {
    throw new Error(`Input directory not found: ${inputDir}`);
  }

  const reports = loadReportsFromDirectory(inputDir);
  if (reports.length === 0) {
    throw new Error(`No evaluation reports found in: ${inputDir}`);
  }

  const fit = fitCalibrationProfile(reports, DEFAULT_EVALUATION_CONFIG, {
    labelMode,
    shrinkage,
    bucketCount,
    minMetricSamples,
    profileName: path.basename(outputPath, path.extname(outputPath)),
    source: path.relative(process.cwd(), inputDir) || inputDir,
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(fit.profile, null, 2), 'utf-8');

  if (!hasFlag(args, '--quiet')) {
    process.stdout.write(`Saved calibration profile to ${outputPath}\n`);
    process.stdout.write(
      `Findings=${fit.totalFindings}, ECE=${fit.globalCalibration.expectedCalibrationError.toFixed(4)}, Brier=${fit.globalCalibration.brierScore.toFixed(4)}\n`
    );
  }
}

main();
