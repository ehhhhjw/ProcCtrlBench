import * as fs from 'fs';
import * as path from 'path';

export interface PrewarnItem {
  metric: string;
  message: string;
  details?: Record<string, any>;
  timestamp: string;
}

/**
 * Writes prewarn information to output/prewarn.json so that runtime systems or
 * downstream stages can consume it.
 */
export function writePrewarn(item: Omit<PrewarnItem, 'timestamp'>) {
  // Toggled by an environment variable, enabled by default: PREWARN_ENABLED=1
  if (process.env.PREWARN_ENABLED === '0' || process.env.PREWARN_ENABLED === 'false') {
    return;
  }
  const outDir = path.join(process.cwd(), 'output');
  const outPath = path.join(outDir, 'prewarn.json');
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const record: PrewarnItem = { ...item, timestamp: new Date().toISOString() };
    const exists = fs.existsSync(outPath);
    if (!exists) {
      fs.writeFileSync(outPath, JSON.stringify([record], null, 2), 'utf-8');
    } else {
      const arr = JSON.parse(fs.readFileSync(outPath, 'utf-8')) as PrewarnItem[];
      arr.push(record);
      fs.writeFileSync(outPath, JSON.stringify(arr, null, 2), 'utf-8');
    }
  } catch (e) {
    // Ignore write errors; evaluation should not fail because of them
  }
}
