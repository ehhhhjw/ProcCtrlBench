const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAllPaperArtifacts,
  buildFig2a,
  buildFig6,
  buildFig8,
  buildTable1,
  buildTable2,
  buildTable3,
  buildTable4,
  buildTable5,
  buildTable6,
  buildTable7,
  caseKeyOfRecord,
  defectPosteriorRisk,
  defectTriggered,
  recordToScorecardInput,
} = require('../../dist/src/benchmark/PaperArtifacts.js');
const { PROCCTRL_DEFECT_KEYS } = require('../../dist/src/benchmark/ProcCtrlScorecard.js');

/** 构造一条最小可用的轨迹记录 */
function makeRecord(overrides = {}) {
  const record = {
    variant: 'system-a',
    benchmark: 'terminal-bench',
    source: 'terminal-bench',
    outcomeMetric: 'successRate',
    taskId: 'task-1',
    trialId: 'trial-1',
    success: true,
    tokens: 100,
    costUsd: 0.1,
    rawPath: '/data/terminal/task-1/trial-1.json',
    totalWarnings: 0,
    totalErrors: 0,
    overallRisk: 0.2,
    averagePosteriorRisk: 0.2,
    warningFindings: 0,
    errorFindings: 0,
    controlPreservation: 0.8,
    controlLevel: 'strong',
    interpretability: 0.8,
    interruptibility: 0.7,
    corrigibility: 0.75,
    reversibility: 0.7,
    handoffAwareness: 0.72,
    autonomyLevel: 0.8,
    recommendedActions: [],
    taskCompletionRate: 1,
    outputExecutability: 1,
    postModificationVerificationRate: 1,
    analyzedSteps: 10,
    totalEvents: 20,
    qCtx: 0.9,
    qTool: 0.8,
    qWf: 0.85,
    qEco: 0.87,
    qDef: 0.855,
    pb: 0.8275,
    pbEta: 0.5,
  };

  for (const key of PROCCTRL_DEFECT_KEYS) {
    record[`${key}PosteriorRisk`] = 0;
    record[`${key}Warnings`] = 0;
    record[`${key}Errors`] = 0;
    record[`${key}Triggered`] = false;
  }

  return { ...record, ...overrides };
}

test('caseKeyOfRecord prefers rawPath and falls back to benchmark/task/trial', () => {
  assert.equal(caseKeyOfRecord(makeRecord()), '/data/terminal/task-1/trial-1.json');
  assert.equal(
    caseKeyOfRecord(makeRecord({ rawPath: undefined })),
    'terminal-bench/task-1/trial-1'
  );
});

test('recordToScorecardInput maps internal CP names onto paper wording', () => {
  const input = recordToScorecardInput(makeRecord());
  assert.equal(input.controlSubdimensions.correctability, 0.75, 'corrigibility -> correctability');
  assert.equal(input.controlSubdimensions.authorityHandoff, 0.72, 'handoffAwareness -> authorityHandoff');
  assert.equal(input.dimensionQuality.toolUseEfficiency, 0.8);
});

test('defectTriggered and defectPosteriorRisk read the per-defect fields', () => {
  const record = makeRecord({ deadStepTriggered: true, deadStepPosteriorRisk: 0.62 });
  assert.equal(defectTriggered(record, 'deadStep'), true);
  assert.equal(defectPosteriorRisk(record, 'deadStep'), 0.62);
  assert.equal(defectTriggered(record, 'ghostContext'), false);
  assert.equal(defectPosteriorRisk(record, 'ghostContext'), 0);
});

test('annotation-dependent artifacts are blocked rather than emitted empty', () => {
  const records = [makeRecord()];
  const table1 = buildTable1(records, []);

  for (const artifact of [table1.detection, table1.calibration, table1.reliability]) {
    assert.equal(artifact.status, 'blocked');
    assert.equal(artifact.rows.length, 0);
    assert.match(artifact.reason, /human annotations are required/);
  }

  const table5 = buildTable5([]);
  assert.equal(table5.status, 'blocked');
  assert.match(table5.reason, /dual-annotated set/);
});

test('buildTable1 blocks when annotations cannot be joined to any trajectory', () => {
  const annotationRows = [
    {
      caseId: 'unmatched-case',
      benchmark: 'terminal-bench',
      success: true,
      rawPath: '/nowhere/else.json',
      defect: 'deadStep',
      annotatorA: 'present',
      annotatorB: 'present',
      finalJudgment: 'present',
      label: true,
      exempt: false,
      adjudicated: false,
    },
  ];

  const table1 = buildTable1([makeRecord()], annotationRows);
  assert.equal(table1.detection.status, 'blocked');
  assert.match(table1.detection.reason, /could be matched to a trajectory record/);
});

test('buildTable1 computes detection metrics once annotations line up', () => {
  const records = [
    makeRecord({ rawPath: '/t/1.json', deadStepTriggered: true, deadStepPosteriorRisk: 0.9 }),
    makeRecord({ rawPath: '/t/2.json', deadStepTriggered: false, deadStepPosteriorRisk: 0.1 }),
  ];
  const annotationRows = records.map((record, index) => ({
    caseId: record.rawPath,
    benchmark: record.benchmark,
    success: true,
    rawPath: record.rawPath,
    defect: 'deadStep',
    annotatorA: index === 0 ? 'present' : 'absent',
    annotatorB: index === 0 ? 'present' : 'absent',
    finalJudgment: index === 0 ? 'present' : 'absent',
    label: index === 0,
    exempt: false,
    adjudicated: false,
  }));

  const table1 = buildTable1(records, annotationRows);
  assert.equal(table1.detection.status, 'generated');

  const deadStep = table1.detection.rows.find((row) => row.abbreviation === 'DeadStep');
  assert.equal(deadStep.precision, 1);
  assert.equal(deadStep.recall, 1);
  assert.equal(deadStep.auroc, 1);
  assert.equal(deadStep.support, 2);

  // 只标了 Tool-Use Efficiency 的一个缺陷，其他维度不应凭空出现
  const dimensions = table1.calibration.rows.map((row) => row.dimension);
  assert.ok(dimensions.includes('Tool-Use Efficiency'));
  assert.ok(!dimensions.includes('Context Management'));
});

test('buildTable2 aggregates one row per system ordered by PB', () => {
  const records = [
    makeRecord({ variant: 'weak', qDef: 0.5, controlPreservation: 0.5, pb: 0.5 }),
    makeRecord({ variant: 'strong', qDef: 0.9, controlPreservation: 0.9, pb: 0.9 }),
  ];

  const table2 = buildTable2(records);
  assert.equal(table2.status, 'generated');
  assert.equal(table2.rows.length, 2);
  assert.equal(table2.rows[0].system, 'strong', 'rows must be sorted by PB descending');
  assert.ok(table2.rows[0].pb > table2.rows[1].pb);
});

test('buildTable2 blocks on an empty record set', () => {
  const table2 = buildTable2([]);
  assert.equal(table2.status, 'blocked');
  assert.equal(table2.rows.length, 0);
});

test('buildTable3 marks task sources with no samples as null, not zero', () => {
  const records = [makeRecord({ benchmark: 'terminal-bench' })];
  const table3 = buildTable3(records);

  assert.equal(table3.status, 'generated');
  const row = table3.rows[0];
  assert.ok(typeof row.terminalBench === 'number');
  assert.equal(row.androidBench, null, 'no AndroidBench samples must read as null');
  assert.equal(row.sweBenchVerified, null);
});

test('buildTable4 ranks with competition semantics and reports rank shift', () => {
  const records = [
    // 系统 A：端点成功率更高但过程分更低
    makeRecord({ variant: 'A', success: true, qDef: 0.5, controlPreservation: 0.5, pb: 0.5 }),
    makeRecord({ variant: 'A', success: true, qDef: 0.5, controlPreservation: 0.5, pb: 0.5 }),
    makeRecord({ variant: 'B', success: true, qDef: 0.95, controlPreservation: 0.95, pb: 0.95 }),
    makeRecord({ variant: 'B', success: false, qDef: 0.95, controlPreservation: 0.95, pb: 0.95 }),
  ];

  const table4 = buildTable4(records);
  assert.equal(table4.status, 'generated');

  const a = table4.rows.find((row) => row.system === 'A');
  const b = table4.rows.find((row) => row.system === 'B');
  assert.equal(a.outcomeScore, 1);
  assert.equal(b.outcomeScore, 0.5);
  assert.equal(a.outcomeRank, 1);
  assert.equal(b.outcomeRank, 2);
  // B 过程质量更好，因此 PB 排名领先，rankShift 为正
  assert.equal(b.pbRank, 1);
  assert.equal(b.rankShift, 1);
  assert.equal(a.rankShift, -1);
});

test('buildTable4 blocks when no trajectory carries an endpoint outcome', () => {
  const table4 = buildTable4([makeRecord({ success: null })]);
  assert.equal(table4.status, 'blocked');
  assert.match(table4.reason, /endpoint outcome/);
});

test('buildTable6 blocks with a single system and works with two', () => {
  const single = buildTable6([makeRecord()], { replicates: 20 });
  assert.equal(single.status, 'blocked');
  assert.match(single.reason, /at least two systems/);

  const records = [
    makeRecord({ variant: 'A', pb: 0.9 }),
    makeRecord({ variant: 'B', pb: 0.4 }),
  ];
  const multi = buildTable6(records, { replicates: 50, seed: 5 });
  assert.equal(multi.status, 'generated');
  assert.equal(multi.rows[0].system, 'A');
  assert.equal(multi.rows[0].top1Frequency, 1);
});

test('buildTable7 exposes the paper control-preservation column names', () => {
  const table7 = buildTable7([makeRecord()]);
  assert.equal(table7.status, 'generated');

  const columns = Object.keys(table7.rows[0]);
  assert.ok(columns.includes('correctability'));
  assert.ok(columns.includes('authorityHandoff'));
  assert.ok(!columns.includes('corrigibility'), 'internal naming must not leak into Table 7');
  assert.ok(!columns.includes('handoffAwareness'));
});

test('buildFig2a covers all 11 defects and reports conditional failure rates', () => {
  const records = [
    makeRecord({ success: false, deadStepTriggered: true }),
    makeRecord({ success: true, deadStepTriggered: false }),
  ];

  const fig2a = buildFig2a(records);
  assert.equal(fig2a.status, 'generated');
  assert.equal(fig2a.rows.length, 11);

  const deadStep = fig2a.rows.find((row) => row.abbreviation === 'DeadStep');
  assert.equal(deadStep.failureRateWhenTriggered, 1);
  assert.equal(deadStep.failureRateWhenNotTriggered, 0);
  assert.equal(deadStep.group, 'Tool-Use Efficiency');

  // Long Chain 按论文归入 Tool-Use Efficiency，而非 Workflow Architecture
  const longChain = fig2a.rows.find((row) => row.abbreviation === 'LongChain');
  assert.equal(longChain.group, 'Tool-Use Efficiency');
});

test('buildFig6 emits a full 11x11 matrix with a unit diagonal', () => {
  const records = [
    makeRecord({ deadStepPosteriorRisk: 0.1, longChainPosteriorRisk: 0.2 }),
    makeRecord({ deadStepPosteriorRisk: 0.8, longChainPosteriorRisk: 0.9 }),
    makeRecord({ deadStepPosteriorRisk: 0.5, longChainPosteriorRisk: 0.6 }),
  ];

  const fig6 = buildFig6(records);
  assert.equal(fig6.status, 'generated');
  assert.equal(fig6.rows.length, 121);

  const diagonal = fig6.rows.filter((row) => row.rowDefect === row.columnDefect);
  assert.equal(diagonal.length, 11);
  assert.ok(diagonal.every((row) => row.correlation === 1));

  // deadStep 与 longChain 同向单调，秩相关应为 1
  const pair = fig6.rows.find((row) => row.rowDefect === 'DeadStep' && row.columnDefect === 'LongChain');
  assert.ok(Math.abs(pair.correlation - 1) < 1e-9);
});

test('buildFig6 blocks when there is only one trajectory', () => {
  const fig6 = buildFig6([makeRecord()]);
  assert.equal(fig6.status, 'blocked');
  assert.match(fig6.reason, /at least two trajectories/);
});

test('buildFig8 sweeps eta endpoints to pure Qdef and pure CP', () => {
  const records = [makeRecord({ variant: 'A', qDef: 0.9, controlPreservation: 0.3 })];
  const fig8 = buildFig8(records, 3);

  assert.equal(fig8.status, 'generated');
  const etas = [...new Set(fig8.rows.map((row) => row.eta))].sort((a, b) => a - b);
  assert.deepEqual(etas, [0, 0.5, 1]);

  // eta=0 时 PB 应等于 CP；eta=1 时应等于 Qdef
  assert.ok(Math.abs(fig8.rows.find((row) => row.eta === 0).pb - 0.3) < 1e-9);
  assert.ok(Math.abs(fig8.rows.find((row) => row.eta === 1).pb - 0.9) < 1e-9);
});

test('buildAllPaperArtifacts reports coverage and never silently drops an artifact', () => {
  const records = [
    makeRecord({ variant: 'A', benchmark: 'terminal-bench' }),
    makeRecord({ variant: 'B', benchmark: 'android-bench', pb: 0.6 }),
  ];

  const bundle = buildAllPaperArtifacts(records, [], { replicates: 20 });
  assert.equal(bundle.recordCount, 2);
  assert.equal(bundle.systemCount, 2);
  assert.equal(bundle.annotationRowCount, 0);
  assert.deepEqual(bundle.benchmarks, ['android-bench', 'terminal-bench']);

  // 19 项产出：Table 1 拆两块 + Table 2/4/5/6/7/8/10/12/13/14/15
  // + Figure 2a/3/4/5/7/8
  assert.equal(bundle.artifacts.length, 19);
  assert.ok(bundle.artifacts.every((artifact) => artifact.id && artifact.paperRef));

  // 每个 blocked 产出都必须给出原因，且行数为 0
  for (const artifact of bundle.artifacts) {
    if (artifact.status === 'blocked') {
      assert.ok(artifact.reason, `${artifact.id} is blocked without a reason`);
      assert.equal(artifact.rows.length, 0);
    }
  }
});
