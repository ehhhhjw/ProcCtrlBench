import * as fs from 'fs';
import * as path from 'path';
import { ThrashingDetector } from '../../src/detectors/ThrashingDetector';
import { DEFAULT_EVALUATION_CONFIG } from '../../src/config/evaluation.config';
import { SessionData, MessageNode, AgentInfo, BranchTree, SessionStatistics, ToolUseInfo, ToolResultInfo } from '../../ClaudeCodeStructure/src/types';

function sessionWithUsage(usages: Array<{uuid:string,tokens:number,timestamp:number}>): SessionData {
  const stats: SessionStatistics = {
    totalMessages: usages.length,
    messagesByType: { user:0, assistant:usages.length, attachment:0, system:0 },
    totalToolUses: 0, toolUsesByName: {}, totalAgents:0, totalBranches:0, totalReplacements:0,
    totalTokens: { input: usages.reduce((a,b)=>a+b.tokens,0), output: 0 },
    timeRange: { start: usages[0]?.timestamp||0, end: usages[usages.length-1]?.timestamp||0, duration: 0 }
  };
  const s: SessionData = {
    messages: new Map<string, MessageNode>(),
    messagesByMessageId: new Map(),
    agents: new Map<string, AgentInfo>(),
    branchTree: ({}) as BranchTree,
    toolUses: new Map<string, ToolUseInfo>(),
    toolResults: new Map<string, ToolResultInfo>(),
    replacements: new Map(),
    title: 'unit', tags: [], prLinks: [], timeline: [], statistics: stats,
  } as any;
  for (const u of usages) {
    const m: MessageNode = { uuid: u.uuid, messageId: u.uuid, type: 'assistant', timestamp: u.timestamp, content: '', children: [], toolUses: [], toolResults: [], replacements: [], usage: { input_tokens: u.tokens, output_tokens: 0 } } as any;
    s.messages.set(u.uuid, m);
  }
  return s;
}

async function main() {
  const out = path.join(process.cwd(), 'output');
  const prewarn = path.join(out, 'prewarn.json');
  fs.mkdirSync(out, { recursive:true });
  if (fs.existsSync(prewarn)) fs.unlinkSync(prewarn);

  // 构造一个接近窗口阈值的使用场景（默认窗口阈值=0.75，使用量达到0.74*W）
  const W = DEFAULT_EVALUATION_CONFIG.contextWindowSize;
  const near = Math.floor(W * 0.74);
  const s = sessionWithUsage([
    { uuid:'u1', tokens: near, timestamp: 1 },
    { uuid:'u2', tokens: near + Math.floor(W*0.02), timestamp: 2 }, // 接近阈值
  ]);

  const det = new ThrashingDetector(s, DEFAULT_EVALUATION_CONFIG);
  await det.detect();

  if (!fs.existsSync(prewarn)) {
    console.error('未产生 Thrashing 接近阈值的预警');
    process.exit(1);
  }
  const arr = JSON.parse(fs.readFileSync(prewarn,'utf-8'));
  const hit = arr.some((x:any)=> x.metric==='contextThrashing' && String(x.message||'').includes('接近阈值'));
  if (!hit) {
    console.error('未发现 Thrashing 接近阈值预警记录');
    process.exit(1);
  }
  console.log('[ok] thrashing-prewarn: 接近窗口阈值预警生效');
}

main().catch(e=>{ console.error(e); process.exit(1); });

