import * as fs from 'fs';
import * as path from 'path';

type Item = { metric: string; message: string; details?: any; timestamp: string };

const SUGGEST: Record<string, string> = {
  toolCallChain: 'Reduce consecutive identical tool calls; batch them together or adopt a more efficient search.',
  contextThrashing: 'Compress early or process large objects in batches when approaching the window limit.',
  longChain: 'Split into subtasks and set intermediate checkpoints.',
  oversizedRules: 'Trim the System rules; move non-core content out or into an external document.',
  ghostContext: 'Summarize or replace non-consumable payloads; remove the original content immediately.',
  inconsistentToolInterface: 'Unify parameter names/types across similar tools; reduce usage dispersion.',
  weakTool: 'Improve tool descriptions/examples; surface the tool proactively in suitable scenarios.',
  wrapperWorkflow: 'Add validation/transformation/aggregation logic to the Agent, or call the downstream tool directly.',
};

function main() {
  const prewarnPath = process.argv[2] || path.join(process.cwd(), 'output', 'prewarn.json');
  const outPath = process.argv[3] || path.join(process.cwd(), 'output', 'benchmark', 'actions.md');
  if (!fs.existsSync(prewarnPath)) {
    console.error('prewarn.json not found:', prewarnPath);
    process.exit(1);
  }
  const items: Item[] = JSON.parse(fs.readFileSync(prewarnPath, 'utf-8'));
  // Deduplicate and group by metric
  const groups = new Map<string, Item[]>();
  for (const it of items) {
    if (!groups.has(it.metric)) groups.set(it.metric, []);
    groups.get(it.metric)!.push(it);
  }
  const lines: string[] = [];
  lines.push('# Suggestions and Remediation Actions');
  lines.push('');
  for (const [metric, arr] of groups.entries()) {
    const suggest = SUGGEST[metric] || 'Optimize this metric according to the context.';
    lines.push(`## ${metric}`);
    lines.push(`- Suggested action: ${suggest}`);
    lines.push(`- Prewarn entries: ${arr.length}`);
    const examples = arr.slice(-3); // take the 3 most recent
    for (const ex of examples) {
      lines.push(`  - ${ex.timestamp} ${ex.message}`);
    }
    lines.push('');
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
  console.log('Saved actions to', outPath);
}

main();

