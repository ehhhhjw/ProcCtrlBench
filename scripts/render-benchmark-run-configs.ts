import * as path from 'path';
import {
  buildBenchmarkLaunchArtifacts,
  loadBenchmarkRunConfig,
  writeBenchmarkLaunchArtifacts,
} from '../src/config/benchmark-run-config';

function parseArgs(argv: string[]) {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }
    parsed[token.slice(2)] =
      argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : 'true';
  }
  return parsed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = args.config || path.join('config', 'benchmark-model.config.yaml');
  const outputDir = args.output || path.join('output', 'benchmark-run-configs');

  const config = loadBenchmarkRunConfig(configPath);
  const artifacts = buildBenchmarkLaunchArtifacts(config, { outputDir });
  writeBenchmarkLaunchArtifacts(artifacts, outputDir);

  console.log(`Loaded benchmark model config from ${path.resolve(configPath)}`);
  console.log(`Wrote generated launch artifacts to ${path.resolve(outputDir)}`);

  for (const artifact of artifacts) {
    console.log(
      `- ${artifact.benchmarkId}: enabled=${artifact.enabled} model=${artifact.resolvedModel}`
    );
    for (const warning of artifact.warnings) {
      console.warn(`  warning: ${warning}`);
    }
  }
}

main();
