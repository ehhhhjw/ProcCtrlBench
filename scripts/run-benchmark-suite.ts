import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

function run(cmd: string) {
  execSync(cmd, { stdio: 'inherit' });
}

function cleanEvaluationOutputs(outputDir: string) {
  if (!fs.existsSync(outputDir)) {
    return;
  }

  for (const entry of fs.readdirSync(outputDir)) {
    if (
      entry.startsWith('evaluation-') ||
      entry.startsWith('context-analysis-')
    ) {
      fs.rmSync(path.join(outputDir, entry), { recursive: true, force: true });
    }
  }
}

const evaluationOutputDir = path.join(process.cwd(), 'output', 'evaluation-reports');
cleanEvaluationOutputs(evaluationOutputDir);

// 1) build file graph
run(`npx ts-node -O '{"types":["node","./src/types/externals.d.ts"],"skipLibCheck":true}' scripts/build-file-graph.ts`);

// 2) run evaluation example
run(`npx ts-node -O '{"types":["node","./src/types/externals.d.ts"],"skipLibCheck":true}' example/evaluate-session.ts`);

// 3) aggregate benchmark
run('npx ts-node src/benchmark/BenchmarkRunner.ts');

// 4) fit a reusable calibration profile from the generated reports
run('npx ts-node scripts/fit-calibration-profile.ts --quiet');

console.log('Benchmark suite completed. Outputs in output/ folder.');
