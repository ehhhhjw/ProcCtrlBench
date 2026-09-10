import * as fs from 'fs';
import * as path from 'path';

// Copy the reports currently in output/evaluation-reports into the before/after directories,
// simulating a before/after remediation comparison.
// Usage:
//  1) Run an evaluation first to produce the baseline report -> prepare-before-after baseline
//  2) Run another evaluation to produce the after report (or synthesize it by copying) -> prepare-before-after after

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

