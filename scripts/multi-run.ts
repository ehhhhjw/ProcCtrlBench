import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

function run(cmd: string) { execSync(cmd, { stdio: 'inherit' }); }

const OUT = path.join(process.cwd(), 'output', 'evaluation-reports');
fs.mkdirSync(OUT, { recursive: true });

// create N synthetic runs by copying the base JSON with distinct runIds
const base = path.join(OUT, 'evaluation-1c1ff4e6.json');
if (!fs.existsSync(base)) {
  console.error('Base evaluation JSON missing; run example first.');
  process.exit(1);
}

const N = 5;
for (let i = 0; i < N; i++) {
  const j = JSON.parse(fs.readFileSync(base, 'utf-8'));
  j.runId = `synthetic-${i}`;
  j.timestamp = new Date(Date.now() + i * 1000).toISOString();
  fs.writeFileSync(path.join(OUT, `evaluation-synthetic-${i}.json`), JSON.stringify(j, null, 2), 'utf-8');
}

// aggregate benchmark
run('npx ts-node src/benchmark/BenchmarkRunner.ts');
console.log('Multi-run aggregation completed.');

