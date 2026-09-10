import * as fs from 'fs';
import * as path from 'path';
import { DeadStepDetector } from '../../src/detectors/DeadStepDetector';
import { SessionData, MessageNode, ToolUseInfo, ToolResultInfo, AgentInfo, BranchTree, SessionStatistics } from '../../ClaudeCodeStructure/src/types';
import { DEFAULT_EVALUATION_CONFIG } from '../../src/config/evaluation.config';

function buildEmptySession(): SessionData {
  const branch: BranchTree = { mainBranch: { agentId: 'main', messageUuids: [], children: [], depth: 0 }, branches: new Map() } as any;
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
    messages: new Map(),
    messagesByMessageId: new Map(),
    agents: new Map<string, AgentInfo>(),
    branchTree: branch,
    toolUses: new Map<string, ToolUseInfo>(),
    toolResults: new Map<string, ToolResultInfo>(),
    replacements: new Map(),
    title: 'unit',
    tags: [],
    prLinks: [],
    timeline: [],
    statistics: stats,
  } as any;
}

async function main() {
  // write a minimal file-graph.json mapping a.ts -> b.ts
  const outDir = path.join(process.cwd(), 'output');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'file-graph.json'), JSON.stringify({ 'a.ts': ['b.ts'] }, null, 2), 'utf-8');

  const s = buildEmptySession();

  // Step 0: tool-use on a.ts with result content mentioning a.ts
  const msg0: MessageNode = {
    uuid: 'm0', messageId: 'mid-0', type: 'assistant', timestamp: 1, content: '', children: [], toolUses: [], toolResults: [], replacements: []
  } as any;
  const tu0: ToolUseInfo = { id: 'TU1', name: 'Read', input: { file_path: 'a.ts' }, timestamp: 1, messageId: 'mid-0', messageUuid: 'm0', hasResult: true } as any;
  const tr0: ToolResultInfo = { tool_use_id: 'TU1', content: `read a.ts ok`, is_error: false, timestamp: 2, messageId: 'mid-0', messageUuid: 'm0' } as any;
  msg0.toolUses.push(tu0);
  msg0.toolResults.push(tr0);
  s.messages.set('m0', msg0);
  s.messagesByMessageId.set('mid-0', ['m0']);
  s.toolUses.set('TU1', tu0);
  s.toolResults.set('TU1', tr0);

  // Step 1: subsequent write on b.ts (associated to a.ts)
  const msg1: MessageNode = {
    uuid: 'm1', messageId: 'mid-1', type: 'assistant', timestamp: 3, content: '', children: [], toolUses: [], toolResults: [], replacements: []
  } as any;
  const tu1: ToolUseInfo = { id: 'TU2', name: 'Write', input: { file_path: 'b.ts', content: 'x' }, timestamp: 3, messageId: 'mid-1', messageUuid: 'm1', hasResult: true } as any;
  const tr1: ToolResultInfo = { tool_use_id: 'TU2', content: `wrote b.ts`, is_error: false, timestamp: 4, messageId: 'mid-1', messageUuid: 'm1' } as any;
  msg1.toolUses.push(tu1);
  msg1.toolResults.push(tr1);
  s.messages.set('m1', msg1);
  s.messagesByMessageId.set('mid-1', ['m1']);
  s.toolUses.set('TU2', tu1);
  s.toolResults.set('TU2', tr1);

  const det = new DeadStepDetector(s, DEFAULT_EVALUATION_CONFIG);
  const issues = await det.detect();
  const deadStepsTU1 = issues.filter(i => i.metric === 'deadStep' && i.location?.toolUseId === 'TU1');
  if (deadStepsTU1.length > 0) {
    console.error('Expected no deadStep for TU1 due to indirect association, got:', deadStepsTU1.length);
    process.exit(1);
  }
  console.log('[ok] deadstep-indirect-ref: no deadStep reported');
}

main().catch(e => { console.error(e); process.exit(1); });
