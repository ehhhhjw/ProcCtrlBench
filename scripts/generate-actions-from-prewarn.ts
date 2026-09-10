import * as fs from 'fs';
import * as path from 'path';

type Item = { metric: string; message: string; details?: any; timestamp: string };

const SUGGEST: Record<string, string> = {
  toolCallChain: '减少连续相同工具调用；将批处理合并或引入更高效搜索。',
  contextThrashing: '接近窗口上限时提前压缩或分批处理大对象。',
  longChain: '拆分子任务并设置中间检查点。',
  oversizedRules: '精简System规则，移出非核心内容或改为外部文档。',
  ghostContext: '对不可消费payload做摘要/替换；立即移除原文。',
  inconsistentToolInterface: '统一相似工具的参数名/类型；降低使用分散度。',
  weakTool: '改进工具描述/示例；在合适场景主动提示工具。',
  wrapperWorkflow: '为Agent增加验证/转换/聚合逻辑或直接调用下游工具。',
};

function main() {
  const prewarnPath = process.argv[2] || path.join(process.cwd(), 'output', 'prewarn.json');
  const outPath = process.argv[3] || path.join(process.cwd(), 'output', 'benchmark', 'actions.md');
  if (!fs.existsSync(prewarnPath)) {
    console.error('prewarn.json not found:', prewarnPath);
    process.exit(1);
  }
  const items: Item[] = JSON.parse(fs.readFileSync(prewarnPath, 'utf-8'));
  // 去重并按 metric 分组
  const groups = new Map<string, Item[]>();
  for (const it of items) {
    if (!groups.has(it.metric)) groups.set(it.metric, []);
    groups.get(it.metric)!.push(it);
  }
  const lines: string[] = [];
  lines.push('# 建议与整改动作');
  lines.push('');
  for (const [metric, arr] of groups.entries()) {
    const suggest = SUGGEST[metric] || '根据上下文优化该项指标。';
    lines.push(`## ${metric}`);
    lines.push(`- 动作建议：${suggest}`);
    lines.push(`- 预警条目：${arr.length} 条`);
    const examples = arr.slice(-3); // 取最近3条
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

