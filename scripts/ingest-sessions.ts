import * as fs from 'fs';
import * as path from 'path';
import { AgentEvaluator } from '../src/AgentEvaluator';

async function evaluateFile(jsonlPath: string, outDir: string) {
  try {
    const evaluator = await AgentEvaluator.fromJsonlFile(jsonlPath);
    await evaluator.evaluateAndSave(outDir);
    console.log('[ok]', jsonlPath);
  } catch (e) {
    console.error('[fail]', jsonlPath, e);
  }
}

async function main() {
  const root = process.argv[2] || path.join(process.cwd(), 'sessions');
  const outDir = path.join(process.cwd(), 'output', 'evaluation-reports');
  fs.mkdirSync(outDir, { recursive: true });
  if (!fs.existsSync(root)) {
    console.error('Session dir not found:', root);
    process.exit(1);
  }
  const walk = (p: string): string[] => {
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      return fs.readdirSync(p).flatMap(f => walk(path.join(p, f)));
    }
    return p.endsWith('.jsonl') ? [p] : [];
  };
  const files = walk(root);
  console.log('Found', files.length, 'session(s)');
  for (const f of files) {
    await evaluateFile(f, outDir);
  }
  console.log('Done. Reports in', outDir);
}

main().catch(e => { console.error(e); process.exit(1); });

