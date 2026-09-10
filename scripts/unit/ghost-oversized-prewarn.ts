import * as fs from 'fs';
import * as path from 'path';
import { GhostContextDetector } from '../../src/detectors/GhostContextDetector';
import { OversizedRulesDetector } from '../../src/detectors/OversizedRulesDetector';
import { DEFAULT_EVALUATION_CONFIG } from '../../src/config/evaluation.config';
import { SessionData, MessageNode, AgentInfo, BranchTree, SessionStatistics, ToolResultInfo } from '../../ClaudeCodeStructure/src/types';

function sessionWithSystem(content: string): SessionData {
  const stats: SessionStatistics = {
    totalMessages: 1,
    messagesByType: { user:0, assistant:0, attachment:0, system:1 },
    totalToolUses: 0, toolUsesByName: {}, totalAgents:0, totalBranches:0, totalReplacements:0,
    totalTokens: { input: content.length, output: 0 },
    timeRange: { start: 1, end: 1, duration: 0 }
  };
  const s: SessionData = {
    messages: new Map<string, MessageNode>(),
    messagesByMessageId: new Map(),
    agents: new Map<string, AgentInfo>(),
    branchTree: ({}) as BranchTree,
    toolUses: new Map(), toolResults: new Map(), replacements: new Map(),
    title: 'unit', tags: [], prLinks: [], timeline: [], statistics: stats,
  } as any;
  const blocks = [{ type: 'text', text: content }];
  const m: MessageNode = { uuid: 'sys', messageId: 'sys', type: 'system', timestamp: 1, content: blocks as any, children: [], toolUses: [], toolResults: [], replacements: [], usage: { input_tokens: content.length, output_tokens: 0 } } as any;
  s.messages.set('sys', m);
  return s;
}

async function main() {
  const out = path.join(process.cwd(), 'output');
  const prewarn = path.join(out, 'prewarn.json');
  fs.mkdirSync(out, { recursive: true });
  if (fs.existsSync(prewarn)) fs.unlinkSync(prewarn);

  // Oversized 近阈值内容：长度×4 使 estimateTokenSize≈warningTokens*0.9
  const nearContent = 'x'.repeat(Math.floor(DEFAULT_EVALUATION_CONFIG.thresholds.oversizedRules.warningTokens * 0.95 * 4));
  const s1 = sessionWithSystem(nearContent);
  const o = new OversizedRulesDetector(s1, DEFAULT_EVALUATION_CONFIG);
  await o.detect();

  // Ghost 近阈值：使用不可消费payload（近似base64长串），估算token接近阈值
  const s2 = sessionWithSystem('');
  const nearGhost = 'A'.repeat(Math.floor(DEFAULT_EVALUATION_CONFIG.thresholds.ghostContext.warningTokens * 0.95 * 4));
  const tr: ToolResultInfo = { tool_use_id: 'ghostTU', content: nearGhost, is_error: false, timestamp: 2, messageId: 'ghostTU', messageUuid: 'ghostTU' } as any;
  s2.toolResults.set('ghostTU', tr);
  const g = new GhostContextDetector(s2, DEFAULT_EVALUATION_CONFIG);
  await g.detect();

  if (!fs.existsSync(prewarn)) {
    console.error('预期应产生 Oversized/Ghost 的接近阈值预警，但未找到');
    process.exit(1);
  }
  const arr = JSON.parse(fs.readFileSync(prewarn,'utf-8'));
  const hitOversized = arr.some((x:any)=> x.metric==='oversizedRules' && String(x.message||'').includes('接近阈值'));
  const hitGhost = arr.some((x:any)=> x.metric==='ghostContext' && String(x.message||'').includes('接近'));
  if (!hitOversized || !hitGhost) {
    console.error('未发现 Oversized 或 Ghost 的接近阈值预警记录');
    process.exit(1);
  }
  console.log('[ok] ghost-oversized-prewarn: 两项近阈值预警生效');
}

main().catch(e=>{ console.error(e); process.exit(1); });
