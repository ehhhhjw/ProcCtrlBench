import * as fs from 'fs';
import * as path from 'path';

function latestMarkdown(dir: string): string | null {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  if (files.length === 0) return null;
  const stats = files.map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }));
  stats.sort((a,b)=> b.t - a.t);
  return path.join(dir, stats[0].f);
}

function main() {
  const reportsDir = path.join(process.cwd(), 'output', 'evaluation-reports');
  const comparePath = process.argv[2] || path.join(process.cwd(), 'output', 'benchmark', 'compare-summary.md');
  if (!fs.existsSync(comparePath)) {
    console.error('compare-summary not found:', comparePath);
    process.exit(1);
  }
  const target = latestMarkdown(reportsDir);
  if (!target) {
    console.error('no markdown report found in', reportsDir);
    process.exit(1);
  }
  const compare = fs.readFileSync(comparePath, 'utf-8');
  const section = `\n\n## 整改前/后对比\n\n${compare}\n`;
  fs.appendFileSync(target, section, 'utf-8');
  console.log('Appended compare summary to', target);
}

main();

