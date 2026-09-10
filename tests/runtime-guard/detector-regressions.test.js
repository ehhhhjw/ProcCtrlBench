const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DeadStepDetector,
} = require('../../dist/src/detectors/DeadStepDetector.js');
const {
  GhostContextDetector,
} = require('../../dist/src/detectors/GhostContextDetector.js');
const {
  CouplingDetector,
} = require('../../dist/src/detectors/CouplingDetector.js');
const {
  EventStreamConverter,
} = require('../../dist/src/analyzers/EventStreamConverter.js');
const {
  DEFAULT_EVALUATION_CONFIG,
} = require('../../dist/src/config/evaluation.config.js');

function buildEmptySession() {
  return {
    messages: new Map(),
    messagesByMessageId: new Map(),
    agents: new Map(),
    branchTree: { mainBranch: { agentId: 'main', messageUuids: [], children: [], depth: 0 }, branches: new Map() },
    toolUses: new Map(),
    toolResults: new Map(),
    replacements: new Map(),
    title: 'unit',
    tags: [],
    prLinks: [],
    timeline: [],
    statistics: {
      totalMessages: 0,
      messagesByType: { user: 0, assistant: 0, attachment: 0, system: 0 },
      totalToolUses: 0,
      toolUsesByName: {},
      totalAgents: 0,
      totalBranches: 0,
      totalReplacements: 0,
      totalTokens: { input: 0, output: 0 },
      timeRange: { start: 0, end: 0, duration: 0 },
    },
  };
}

function addAssistantMessage(
  session,
  { uuid, timestamp, content = '', parentUuid = null, usage, toolUses = [], toolResults = [] }
) {
  addMessage(session, {
    uuid,
    timestamp,
    type: 'assistant',
    content,
    parentUuid,
    usage,
    toolUses,
    toolResults,
  });
}

function addMessage(
  session,
  {
    uuid,
    timestamp,
    type = 'assistant',
    messageId = uuid,
    content = '',
    parentUuid = null,
    usage,
    toolUses = [],
    toolResults = [],
    replacements = [],
  }
) {
  const message = {
    uuid,
    messageId,
    type,
    timestamp,
    content,
    parentUuid,
    children: [],
    toolUses: [...toolUses],
    toolResults: [...toolResults],
    replacements: [...replacements],
    usage,
  };

  session.messages.set(uuid, message);
  const grouped = session.messagesByMessageId.get(messageId) || [];
  grouped.push(uuid);
  session.messagesByMessageId.set(messageId, grouped);
  session.statistics.totalMessages += 1;
  session.statistics.messagesByType[type] += 1;
  session.statistics.timeRange.end = Math.max(session.statistics.timeRange.end, timestamp);
  if (session.statistics.timeRange.start === 0) {
    session.statistics.timeRange.start = timestamp;
  }
  session.statistics.timeRange.duration =
    session.statistics.timeRange.end - session.statistics.timeRange.start;

  if (parentUuid && session.messages.has(parentUuid)) {
    session.messages.get(parentUuid).children.push(uuid);
  }

  if (usage) {
    session.statistics.totalTokens.input += usage.input_tokens || 0;
    session.statistics.totalTokens.output += usage.output_tokens || 0;
  }

  for (const toolUse of toolUses) {
    session.toolUses.set(toolUse.id, toolUse);
    session.statistics.totalToolUses += 1;
    session.statistics.toolUsesByName[toolUse.name] =
      (session.statistics.toolUsesByName[toolUse.name] || 0) + 1;
  }

  for (const toolResult of toolResults) {
    session.toolResults.set(toolResult.tool_use_id, toolResult);
  }
}

function createToolPair({
  id,
  name,
  timestamp,
  filePath,
  resultContent,
  input = {},
}) {
  const toolUse = {
    id,
    name,
    input: { file_path: filePath, ...input },
    timestamp,
    messageId: `m-${id}`,
    messageUuid: `m-${id}`,
    hasResult: true,
  };
  const toolResult = {
    tool_use_id: id,
    content: resultContent,
    is_error: false,
    timestamp: timestamp + 1,
    messageId: `m-${id}`,
    messageUuid: `m-${id}`,
  };
  return { toolUse, toolResult };
}

test('deadStep does not flag code edits that remain referenced in later assistant context', async () => {
  const session = buildEmptySession();
  const { toolUse, toolResult } = createToolPair({
    id: 'edit-1',
    name: 'Edit',
    timestamp: 1,
    filePath: 'src/app.ts',
    resultContent: 'Updated function handleOrder in src/app.ts',
  });

  addAssistantMessage(session, {
    uuid: 'm-edit-1',
    timestamp: 1,
    toolUses: [toolUse],
    toolResults: [toolResult],
  });
  addAssistantMessage(session, {
    uuid: 'm-summary',
    timestamp: 5,
    parentUuid: 'm-edit-1',
    content: 'Next I will verify that handleOrder in src/app.ts still respects the new branch logic.',
  });

  const detector = new DeadStepDetector(session, DEFAULT_EVALUATION_CONFIG);
  const issues = await detector.detect();

  assert.equal(
    issues.some((issue) => issue.metric === 'deadStep' && issue.location?.toolUseId === 'edit-1'),
    false
  );
});

test('deadStep does not flag the final code modification step', async () => {
  const session = buildEmptySession();
  const { toolUse, toolResult } = createToolPair({
    id: 'edit-last',
    name: 'Edit',
    timestamp: 1,
    filePath: 'src/final.ts',
    resultContent: 'Applied final fix to src/final.ts',
  });

  addAssistantMessage(session, {
    uuid: 'm-edit-last',
    timestamp: 1,
    toolUses: [toolUse],
    toolResults: [toolResult],
  });

  const detector = new DeadStepDetector(session, DEFAULT_EVALUATION_CONFIG);
  const issues = await detector.detect();

  assert.equal(
    issues.some((issue) => issue.metric === 'deadStep' && issue.location?.toolUseId === 'edit-last'),
    false
  );
});

test('event stream context tokens only include the active ancestor chain', () => {
  const session = buildEmptySession();

  addMessage(session, {
    uuid: 'root',
    timestamp: 1,
    type: 'assistant',
    content: 'root',
    usage: { input_tokens: 60, output_tokens: 40 },
  });
  addMessage(session, {
    uuid: 'branch-a',
    timestamp: 2,
    type: 'assistant',
    parentUuid: 'root',
    content: 'branch-a',
    usage: { input_tokens: 20, output_tokens: 10 },
  });
  addMessage(session, {
    uuid: 'branch-b',
    timestamp: 3,
    type: 'assistant',
    parentUuid: 'root',
    content: 'branch-b',
    usage: { input_tokens: 120, output_tokens: 80 },
  });
  addMessage(session, {
    uuid: 'branch-a-child',
    timestamp: 4,
    type: 'assistant',
    parentUuid: 'branch-a',
    content: 'branch-a-child',
    usage: { input_tokens: 15, output_tokens: 5 },
  });

  const converter = new EventStreamConverter(session);
  const events = converter.convert();
  const targetEvent = events.find((event) => event.messageUuid === 'branch-a-child');

  assert.ok(targetEvent);
  assert.equal(targetEvent.context_tokens_before, 130);
  assert.equal(targetEvent.context_tokens_after, 150);
});

test('deadStep only treats descendant messages as valid downstream usage', async () => {
  const session = buildEmptySession();

  addMessage(session, {
    uuid: 'root-user',
    timestamp: 1,
    type: 'user',
    content: 'Investigate branch-specific fix',
  });

  const editStep = createToolPair({
    id: 'edit-branch-a',
    name: 'Edit',
    timestamp: 2,
    filePath: 'src/app.ts',
    resultContent: 'Updated function handleOrder in src/app.ts',
  });
  addAssistantMessage(session, {
    uuid: 'm-edit-branch-a',
    timestamp: 2,
    parentUuid: 'root-user',
    toolUses: [editStep.toolUse],
    toolResults: [editStep.toolResult],
  });

  const readStep = createToolPair({
    id: 'read-other',
    name: 'Read',
    timestamp: 5,
    filePath: 'src/other.ts',
    resultContent: 'File: src/other.ts',
  });
  addAssistantMessage(session, {
    uuid: 'm-read-other',
    timestamp: 5,
    parentUuid: 'root-user',
    content: 'I should revisit handleOrder in src/app.ts later, but this branch is unrelated.',
    toolUses: [readStep.toolUse],
    toolResults: [readStep.toolResult],
  });

  const detector = new DeadStepDetector(session, DEFAULT_EVALUATION_CONFIG);
  const issues = await detector.detect();
  const deadStepIssue = issues.find((issue) => issue.metric === 'deadStep' && issue.location?.toolUseId === 'edit-branch-a');

  assert.ok(deadStepIssue);
});

test('deadStep downgrades fully implicit carry-over from error to warning', async () => {
  const session = buildEmptySession();

  addMessage(session, {
    uuid: 'root-user',
    timestamp: 1,
    type: 'user',
    content: 'Inspect the result',
  });

  const readStep = createToolPair({
    id: 'read-implicit-carry',
    name: 'Read',
    timestamp: 2,
    filePath: 'src/opaque.txt',
    resultContent: 'opaque payload that is never explicitly referenced later',
  });

  addAssistantMessage(session, {
    uuid: 'm-read-implicit-carry',
    timestamp: 2,
    parentUuid: 'root-user',
    toolUses: [readStep.toolUse],
    toolResults: [readStep.toolResult],
  });

  addAssistantMessage(session, {
    uuid: 'm-followup',
    timestamp: 5,
    parentUuid: 'm-read-implicit-carry',
    content: 'Proceeding with unrelated next action.',
  });

  const detector = new DeadStepDetector(session, DEFAULT_EVALUATION_CONFIG);
  const issues = await detector.detect();
  const deadStepIssue = issues.find(
    (issue) => issue.metric === 'deadStep' && issue.location?.toolUseId === 'read-implicit-carry'
  );

  assert.ok(deadStepIssue);
  assert.equal(deadStepIssue.severity, 'warning');
  assert.equal(deadStepIssue.evidence.details.hasContextCarry, true);
});

test('ghostContext ignores sibling chatter when deciding whether a summarized result was reused', async () => {
  const session = buildEmptySession();
  const repeated = 'symbolAlpha src/app.ts '.repeat(120);

  addMessage(session, {
    uuid: 'root-user',
    timestamp: 1,
    type: 'user',
    content: 'Inspect the failing branch',
  });

  const readStep = createToolPair({
    id: 'read-large',
    name: 'Read',
    timestamp: 2,
    filePath: 'src/app.ts',
    resultContent: repeated,
  });
  addAssistantMessage(session, {
    uuid: 'm-read-large',
    timestamp: 2,
    parentUuid: 'root-user',
    toolUses: [readStep.toolUse],
    toolResults: [readStep.toolResult],
  });

  session.replacements.set('replacement-1', {
    uuid: 'replacement-1',
    timestamp: 4,
    messageId: readStep.toolResult.messageId,
    toolUseId: readStep.toolUse.id,
    originalContent: repeated,
    replacementContent: 'summary of symbolAlpha in src/app.ts',
    reason: 'compress',
  });

  addAssistantMessage(session, {
    uuid: 'm-sibling-summary',
    timestamp: 5,
    parentUuid: 'root-user',
    content: 'A sibling branch also mentions symbolAlpha in src/app.ts, but it does not inherit the read result.',
  });

  const detector = new GhostContextDetector(session, DEFAULT_EVALUATION_CONFIG);
  const issues = await detector.detect();
  const ghostIssue = issues.find(
    (issue) =>
      issue.metric === 'ghostContext' &&
      issue.location?.messageUuid === 'm-read-large' &&
      String(issue.message || '').includes('unreferenced historical result')
  );

  assert.ok(ghostIssue);
});

test('contextCoupling ignores package-domain noise when all steps stay on the same Java file', async () => {
  const session = buildEmptySession();
  const javaFile = '/workspace/android/src/com/example/NaviConstant.java';

  const stepA = createToolPair({
    id: 'read-a',
    name: 'Read',
    timestamp: 1,
    filePath: javaFile,
    resultContent: [
      `File: ${javaFile}`,
      'package com.example.navi.constant;',
      'host: internal.example.com',
    ].join('\n'),
  });
  const stepB = createToolPair({
    id: 'read-b',
    name: 'Read',
    timestamp: 3,
    filePath: javaFile,
    resultContent: `File: ${javaFile}`,
  });
  const stepC = createToolPair({
    id: 'read-c',
    name: 'Read',
    timestamp: 5,
    filePath: javaFile,
    resultContent: [
      `File: ${javaFile}`,
      'package com.example.navi.constant;',
      'host: internal.example.com',
    ].join('\n'),
  });

  addAssistantMessage(session, {
    uuid: 'm-read-a',
    timestamp: 1,
    toolUses: [stepA.toolUse],
    toolResults: [stepA.toolResult],
  });
  addAssistantMessage(session, {
    uuid: 'm-read-b',
    timestamp: 3,
    toolUses: [stepB.toolUse],
    toolResults: [stepB.toolResult],
  });
  addAssistantMessage(session, {
    uuid: 'm-read-c',
    timestamp: 5,
    toolUses: [stepC.toolUse],
    toolResults: [stepC.toolResult],
  });

  const detector = new CouplingDetector(session, DEFAULT_EVALUATION_CONFIG);
  const issues = await detector.detect();

  assert.equal(
    issues.some(
      (issue) =>
        issue.metric === 'contextCoupling' &&
        String(issue.message || '').includes('code context coupling')
    ),
    false
  );
});
