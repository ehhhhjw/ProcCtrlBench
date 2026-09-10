import { execSync } from 'child_process';

function run(cmd: string) { execSync(cmd, { stdio: 'inherit' }); }

// One-shot pipeline: evaluate -> copy baseline -> multi-run -> copy after -> compare -> generate/append the comparison section
run('npx ts-node scripts/run-benchmark-suite.ts');
run('npx ts-node scripts/prepare-before-after.ts baseline');
run('npx ts-node scripts/multi-run.ts');
run('npx ts-node scripts/prepare-before-after.ts after');
run('npx ts-node scripts/compare-reports.ts output/evaluation-reports/before output/evaluation-reports/after output/benchmark/compare-summary.md');

// Trigger ReportGenerator to append the compare section automatically: evaluate once more, or append directly
run('npx ts-node scripts/run-benchmark-suite.ts');

console.log('before/after pipeline completed.');

