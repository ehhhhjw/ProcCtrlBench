import * as fs from 'fs';
import * as path from 'path';
import { ToolChainDetector } from '../../src/detectors/ToolChainDetector';
import { DEFAULT_EVALUATION_CONFIG } from '../../src/config/evaluation.config';
import { SessionData, ToolUseInfo, MessageNode, AgentInfo, BranchTree, SessionStatistics } from '../../ClaudeCodeStructure/src/types';

function emptySession(): SessionData {
  const stats: SessionStatistics = {
    totalMessages: 0,
    messagesByType: { user:0, assistant:0, attachment:0, system:0 },
    totalToolUses: 0,
    toolUsesByName: {},
    totalAgents: 0,
    totalBranches: 0,
    totalReplacements: 0,
    totalTokens: { input: 0, output: 0 },
    timeRange: { start: 0, end: 0, duration: 0 }
  };
  return {
    messages: new Map<string, MessageNode>(),
    messagesByMessageId: new Map(),
    agents: new Map<string, AgentInfo>(),
    branchTree: ({}) as BranchTree,
    toolUses: new Map<string, ToolUseInfo>(),
    toolResults: new Map(),
    replacements: new Map(),
    title: 'unit', tags: [], prLinks: [], timeline: [], statistics: stats,
  } as any;
}

async function main() {
  const out = path.join(process.cwd(), 'output');
  const prewarn = path.join(out, 'prewarn.json');
  fs.mkdirSync(out, { recursive: true });
  if (fs.existsSync(prewarn)) fs.unlinkSync(prewarn);

  const s = emptySession();
  // 构造连续5次相同工具调用（默认重复链预警阈值为6，接近阈值应写预警）
  for (let i = 0; i < 5; i++) {
    const id = `TU${i}`;
    const t: ToolUseInfo = { id, name: 'Read', input: { file_path: `f${i}.ts` }, timestamp: i, messageId: `m${i}`, messageUuid: `m${i}`, hasResult: false } as any;
    s.toolUses.set(id, t);
  }
  // 切换工具，促使检测器结算前一段链
  s.toolUses.set('TU5', { id: 'TU5', name: 'Grep', input: {}, timestamp: 6, messageId: 'm5', messageUuid: 'm5', hasResult: false } as any);

  const det = new ToolChainDetector(s, DEFAULT_EVALUATION_CONFIG);
  await det.detect();

  if (!fs.existsSync(prewarn)) {
    console.error('预期应产生预警(prewarn.json)，但未找到');
    process.exit(1);
  }
  const arr = JSON.parse(fs.readFileSync(prewarn, 'utf-8'));
  const hit = arr.some((x: any) => x.metric === 'toolCallChain' && String(x.message || '').includes('接近重复调用阈值'));
  if (!hit) {
    console.error('未发现“接近重复调用阈值”的预警记录');
    process.exit(1);
  }
  console.log('[ok] toolchain-prewarn: 产生接近重复链阈值的预警');
}

main().catch(e => { console.error(e); process.exit(1); });

