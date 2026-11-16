import * as fs from 'fs';
import * as path from 'path';
import { InterfaceConsistencyDetector } from '../../src/detectors/InterfaceConsistencyDetector';
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
  fs.mkdirSync(out, { recursive:true });
  if (fs.existsSync(prewarn)) fs.unlinkSync(prewarn);

  const s = emptySession();
  // Build calls in the file_read group: Read 9, Grep 6, Glob 1 -> dispersion runs high, near the prewarn threshold
  let ts = 0;
  const add = (name:string)=>{
    const id = `TU_${name}_${ts}`;
    const t: ToolUseInfo = { id, name, input: { file_path: `f${ts}.ts`, extra: ts%2===0? 'a':'b' }, timestamp: ts++, messageId: `m${ts}`, messageUuid: `m${ts}`, hasResult: false } as any;
    s.toolUses.set(id, t);
  };
  for (let i=0;i<9;i++) add('Read');
  for (let i=0;i<6;i++) add('Grep');
  add('Glob');

  const det = new InterfaceConsistencyDetector(s, DEFAULT_EVALUATION_CONFIG);
  await det.detect();

  if (!fs.existsSync(prewarn)) {
    console.error('Expected an interface-dispersion near-threshold prewarn, but prewarn.json was not found');
    process.exit(1);
  }
  const arr = JSON.parse(fs.readFileSync(prewarn,'utf-8'));
  const hit = arr.some((x:any)=> x.metric==='inconsistentToolInterface' && String(x.message||'').includes('dispersion near threshold'));
  if (!hit) {
    console.error('No near-threshold prewarn found for interface dispersion');
    process.exit(1);
  }
  console.log('[ok] interface-dispersion-prewarn: near-threshold prewarn fired');
}

main().catch(e=>{ console.error(e); process.exit(1); });

