import * as fs from 'fs';
import * as path from 'path';
import { LongChainDetector } from '../../src/detectors/LongChainDetector';
import { DEFAULT_EVALUATION_CONFIG } from '../../src/config/evaluation.config';
import { SessionData, MessageNode, AgentInfo, BranchTree, SessionStatistics } from '../../ClaudeCodeStructure/src/types';

function sessionWithSteps(n: number): SessionData {
  const stats: SessionStatistics = {
    totalMessages: n,
    messagesByType: { user:0, assistant:n, attachment:0, system:0 },
    totalToolUses: 0, toolUsesByName: {}, totalAgents:0, totalBranches:0, totalReplacements:0,
    totalTokens: { input: 0, output: 0 },
    timeRange: { start: 1, end: n, duration: 0 }
  };
  const s: SessionData = {
    messages: new Map<string, MessageNode>(),
    messagesByMessageId: new Map(),
    agents: new Map<string, AgentInfo>(),
    branchTree: ({}) as BranchTree,
    toolUses: new Map(), toolResults: new Map(), replacements: new Map(),
    title: 'unit', tags: [], prLinks: [], timeline: [], statistics: stats,
  } as any;
  for (let i = 0; i < n; i++) {
    const m: MessageNode = { uuid: `m${i}`, messageId: `m${i}`, type: 'assistant', timestamp: i+1, content: '', children: [], toolUses: [], toolResults: [], replacements: [] } as any;
    s.messages.set(`m${i}`, m);
  }
  return s;
}

async function main() {
  const out = path.join(process.cwd(), 'output');
  const prewarn = path.join(out, 'prewarn.json');
  fs.mkdirSync(out, { recursive:true });
  if (fs.existsSync(prewarn)) fs.unlinkSync(prewarn);

  const near = DEFAULT_EVALUATION_CONFIG.thresholds.longChain.simpleWarningLength - 1;
  const s = sessionWithSteps(near);
  const det = new LongChainDetector(s, DEFAULT_EVALUATION_CONFIG);
  await det.detect();
  if (!fs.existsSync(prewarn)) {
    console.error('未产生 LongChain 接近阈值的预警');
    process.exit(1);
  }
  const arr = JSON.parse(fs.readFileSync(prewarn,'utf-8'));
  const hit = arr.some((x:any)=> x.metric==='longChain' && String(x.message||'').includes('接近'));
  if (!hit) {
    console.error('未发现 LongChain 接近阈值预警记录');
    process.exit(1);
  }
  console.log('[ok] longchain-prewarn: 接近阈值预警生效');
}

main().catch(e=>{ console.error(e); process.exit(1); });

