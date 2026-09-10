const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  AgentEvaluator,
} = require('../../dist/src/AgentEvaluator.js');
const {
  DEFAULT_EVALUATION_CONFIG,
} = require('../../dist/src/config/evaluation.config.js');

function buildSession() {
  const session = {
    messages: new Map(),
    messagesByMessageId: new Map(),
    agents: new Map(),
    branchTree: { mainBranch: { agentId: 'main', messageUuids: [], children: [], depth: 0 }, branches: new Map() },
    toolUses: new Map(),
    toolResults: new Map(),
    replacements: new Map(),
    title: 'context-analysis',
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

  const addMessage = ({ uuid, type, timestamp, parentUuid = null, content = '', usage }) => {
    const message = {
      uuid,
      messageId: uuid,
      type,
      timestamp,
      parentUuid,
      content,
      children: [],
      toolUses: [],
      toolResults: [],
      replacements: [],
      usage,
    };

    session.messages.set(uuid, message);
    session.messagesByMessageId.set(uuid, [uuid]);
    session.statistics.totalMessages += 1;
    session.statistics.messagesByType[type] += 1;
    session.statistics.timeRange.end = Math.max(session.statistics.timeRange.end, timestamp);
    if (session.statistics.timeRange.start === 0) {
      session.statistics.timeRange.start = timestamp;
    }
    session.statistics.timeRange.duration =
      session.statistics.timeRange.end - session.statistics.timeRange.start;

    if (usage) {
      session.statistics.totalTokens.input += usage.input_tokens;
      session.statistics.totalTokens.output += usage.output_tokens;
    }

    if (parentUuid && session.messages.has(parentUuid)) {
      session.messages.get(parentUuid).children.push(uuid);
    }
  };

  addMessage({
    uuid: 'root-user',
    type: 'user',
    timestamp: 1,
    content: 'Fix the regression',
  });
  addMessage({
    uuid: 'assistant-1',
    type: 'assistant',
    timestamp: 2,
    parentUuid: 'root-user',
    content: 'I will inspect src/app.ts and verify the fix.',
    usage: { input_tokens: 30, output_tokens: 20 },
  });
  addMessage({
    uuid: 'assistant-2',
    type: 'assistant',
    timestamp: 3,
    parentUuid: 'assistant-1',
    content: 'Completed and verified successfully.',
    usage: { input_tokens: 10, output_tokens: 5 },
  });

  return session;
}

test('evaluateAndSave persists context analysis artifact and report summary', async () => {
  const session = buildSession();
  const evaluator = new AgentEvaluator(session, DEFAULT_EVALUATION_CONFIG);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-analysis-report-'));
  const contextChainMapPath = path.join(
    process.cwd(),
    'ClaudeCodeStructure',
    'tests',
    'output',
    'context-chains.json'
  );
  const hadOriginal = fs.existsSync(contextChainMapPath);
  const originalContent = hadOriginal ? fs.readFileSync(contextChainMapPath, 'utf-8') : null;

  try {
    const report = await evaluator.evaluateAndSave(outDir, ['json']);

    assert.ok(report.analysis);
    assert.ok(report.analysis.contextChains);
    assert.ok(report.analysis.standardEventStream);
    assert.equal(report.analysis.contextChains.analyzedSteps, 3);
    assert.equal(report.analysis.standardEventStream.totalEvents, 3);
    assert.ok(report.analysis.contextChains.outputPath);
    assert.ok(fs.existsSync(report.analysis.contextChains.outputPath));
    assert.ok(report.analysis.standardEventStream.outputPath);
    assert.ok(fs.existsSync(report.analysis.standardEventStream.outputPath));
    assert.equal(report.analysis.contextChains.contextChainMapPath, contextChainMapPath);
    assert.ok(fs.existsSync(contextChainMapPath));

    const artifact = JSON.parse(fs.readFileSync(report.analysis.contextChains.outputPath, 'utf-8'));
    assert.equal(artifact.summary.analyzedSteps, 3);
    assert.equal(Array.isArray(artifact.steps), true);
    assert.equal(artifact.steps.length, 3);

    const eventArtifact = JSON.parse(fs.readFileSync(report.analysis.standardEventStream.outputPath, 'utf-8'));
    assert.equal(eventArtifact.summary.totalEvents, 3);
    assert.equal(Array.isArray(eventArtifact.events), true);
    assert.equal(eventArtifact.events.length, 3);

    const chainMap = JSON.parse(fs.readFileSync(contextChainMapPath, 'utf-8'));
    assert.deepEqual(chainMap['root-user'], ['root-user']);
    assert.deepEqual(chainMap['assistant-1'], ['root-user', 'assistant-1']);
    assert.deepEqual(chainMap['assistant-2'], ['root-user', 'assistant-1', 'assistant-2']);

    const reportPath = path.join(outDir, `evaluation-${report.runId}.json`);
    const savedReport = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
    assert.equal(savedReport.analysis.contextChains.analyzedSteps, 3);
    assert.ok(savedReport.analysis.contextChains.outputPath.endsWith(`context-analysis-${report.runId}.json`));
    assert.equal(savedReport.analysis.contextChains.contextChainMapPath, contextChainMapPath);
    assert.ok(savedReport.analysis.standardEventStream.outputPath.endsWith(`standard-event-stream-${report.runId}.json`));
    assert.equal(savedReport.analysis.standardEventStream.totalEvents, 3);
    assert.ok(savedReport.findings);
    assert.ok(savedReport.risk);
    assert.ok(savedReport.controlPreservation);
    assert.ok(savedReport.executionGuidance);
    assert.equal(typeof savedReport.executionGuidance.autonomyLevel, 'number');
  } finally {
    if (hadOriginal && originalContent !== null) {
      fs.writeFileSync(contextChainMapPath, originalContent, 'utf-8');
    } else if (fs.existsSync(contextChainMapPath)) {
      fs.unlinkSync(contextChainMapPath);
    }
  }
});
