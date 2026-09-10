import * as fs from 'fs';
import * as path from 'path';

// 将当前 output/evaluation-reports 中的报告复制到 before/after 目录，模拟一次整改前/后对比。
// 用法：
//  1) 先跑一遍评估产生 baseline 报告 → prepare-before-after baseline
//  2) 再跑一次评估产生 after 报告（或复制合成）→ prepare-before-after after

function copyAll(srcDir: string, dstDir: string) {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const f of fs.readdirSync(srcDir)) {
    if (f.endsWith('.json')) {
      const from = path.join(srcDir, f);
      const to = path.join(dstDir, f);
      fs.copyFileSync(from, to);
    }
  }
}

function main() {
  const mode = process.argv[2] || 'baseline'; // baseline|after
  const out = path.join(process.cwd(), 'output', 'evaluation-reports');
  const beforeDir = path.join(out, 'before');
  const afterDir = path.join(out, 'after');
  if (!fs.existsSync(out)) {
    console.error('Missing reports dir:', out);
    process.exit(1);
  }
  if (mode === 'baseline') {
    copyAll(out, beforeDir);
    console.log('Copied baseline to', beforeDir);
  } else {
    copyAll(out, afterDir);
    console.log('Copied after to', afterDir);
  }
}

main();

