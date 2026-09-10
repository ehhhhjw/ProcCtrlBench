import * as fs from 'fs';
import * as path from 'path';

export interface PrewarnItem {
  metric: string;
  message: string;
  details?: Record<string, any>;
  timestamp: string;
}

/**
 * 写入预警信息到 output/prewarn.json，便于运行时系统或后续流程消费。
 */
export function writePrewarn(item: Omit<PrewarnItem, 'timestamp'>) {
  // 通过环境变量控制开关，默认开启：PREWARN_ENABLED=1
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
    // 忽略写入错误，评测不应因此失败
  }
}
