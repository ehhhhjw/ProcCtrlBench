import { execSync } from 'child_process';

function run(cmd: string) { execSync(cmd, { stdio: 'inherit' }); }

// 一键流水线：评估→baseline复制→多跑→after复制→对比→生成/追加对比段落
run('npx ts-node scripts/run-benchmark-suite.ts');
run('npx ts-node scripts/prepare-before-after.ts baseline');
run('npx ts-node scripts/multi-run.ts');
run('npx ts-node scripts/prepare-before-after.ts after');
run('npx ts-node scripts/compare-reports.ts output/evaluation-reports/before output/evaluation-reports/after output/benchmark/compare-summary.md');

// 触发 ReportGenerator 自动附加 compare 段落：再评估一次或直接追加
run('npx ts-node scripts/run-benchmark-suite.ts');

console.log('before/after pipeline completed.');

