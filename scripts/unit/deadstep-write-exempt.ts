import { DeadStepDetector } from '../../src/detectors/DeadStepDetector';
import { DEFAULT_EVALUATION_CONFIG } from '../../src/config/evaluation.config';
import { SessionData, MessageNode, ToolUseInfo, ToolResultInfo, AgentInfo, BranchTree, SessionStatistics } from '../../ClaudeCodeStructure/src/types';

function buildSession(): SessionData {
  const stats: SessionStatistics = {
    totalMessages: 1,
    messagesByType: { user: 0, assistant: 1, attachment: 0, system: 0 },
    totalToolUses: 1,
    toolUsesByName: { Write: 1 },
    totalAgents: 0,
    totalBranches: 0,
    totalReplacements: 0,
    totalTokens: { input: 0, output: 0 },
    timeRange: { start: 1, end: 1, duration: 0 },
  };

  const session: SessionData = {
    messages: new Map<string, MessageNode>(),
    messagesByMessageId: new Map(),
    agents: new Map<string, AgentInfo>(),
    branchTree: ({}) as BranchTree,
    toolUses: new Map<string, ToolUseInfo>(),
    toolResults: new Map<string, ToolResultInfo>(),
    replacements: new Map(),
    title: 'unit',
    tags: [],
    prLinks: [],
    timeline: [],
    statistics: stats,
  } as any;

  const message: MessageNode = {
    uuid: 'm0',
    messageId: 'm0',
    type: 'assistant',
    timestamp: 1,
    content: '',
    children: [],
    toolUses: [],
    toolResults: [],
    replacements: [],
  } as any;

  const toolUse: ToolUseInfo = {
    id: 'tu0',
    name: 'Write',
    input: { file_path: 'a.ts', content: 'export const a = 1;' },
    timestamp: 1,
    messageId: 'm0',
    messageUuid: 'm0',
    hasResult: true,
  } as any;

  const toolResult: ToolResultInfo = {
    tool_use_id: 'tu0',
    content: 'wrote a.ts',
    is_error: false,
    timestamp: 1,
    messageId: 'm0',
    messageUuid: 'm0',
  } as any;

  message.toolUses.push(toolUse);
  message.toolResults.push(toolResult);
  session.messages.set('m0', message);
  session.messagesByMessageId.set('m0', ['m0']);
  session.toolUses.set('tu0', toolUse);
  session.toolResults.set('tu0', toolResult);

  return session;
}

async function main() {
  const detector = new DeadStepDetector(buildSession(), DEFAULT_EVALUATION_CONFIG);
  const issues = await detector.detect();
  const issue = issues.find((item) => item.metric === 'deadStep' && item.location?.toolUseId === 'tu0');
  if (issue) {
    console.error('Write 操作不应被判定为 deadStep:', JSON.stringify(issue, null, 2));
    process.exit(1);
  }
  console.log('[ok] deadstep-write-exempt: Write 不会被判定为 deadStep');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
