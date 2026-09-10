const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  ANNOTATION_SCHEMA_VERSION,
  flattenAnnotationSet,
  hasDisagreement,
  judgmentToLabel,
  loadAnnotationSet,
  resolveFinalJudgment,
  validateAnnotationSet,
} = require('../../dist/src/adapters/AnnotationLoader.js');
const {
  PAPER_SPLIT_SIZES,
  assertSplitDiscipline,
  defaultStratumKey,
  splitAnnotatedCases,
} = require('../../dist/src/benchmark/AnnotationSplit.js');
const { PROCCTRL_DEFECT_KEYS } = require('../../dist/src/benchmark/ProcCtrlScorecard.js');

function fullAnnotations(judgment) {
  const annotations = {};
  for (const key of PROCCTRL_DEFECT_KEYS) {
    annotations[key] = {
      annotatorA: judgment,
      annotatorB: judgment,
      evidence: 'evidence note',
      exemptionRationale: judgment === 'exempt' ? 'validation rerun after an edit' : undefined,
    };
  }
  return annotations;
}

function makeCase(index, benchmark, success, judgment = 'absent') {
  return {
    caseId: `${benchmark}/task-${index}`,
    benchmark,
    taskId: `task-${index}`,
    success,
    annotations: fullAnnotations(judgment),
  };
}

test('judgmentToLabel treats exempt as a negative rather than a defect', () => {
  assert.equal(judgmentToLabel('present'), true);
  assert.equal(judgmentToLabel('absent'), false);
  assert.equal(judgmentToLabel('exempt'), false);
});

test('resolveFinalJudgment prefers adjudication and returns null on unresolved disagreement', () => {
  assert.equal(resolveFinalJudgment({ annotatorA: 'present', annotatorB: 'present' }), 'present');
  assert.equal(
    resolveFinalJudgment({ annotatorA: 'present', annotatorB: 'absent', adjudicated: 'absent' }),
    'absent'
  );
  assert.equal(resolveFinalJudgment({ annotatorA: 'present', annotatorB: 'absent' }), null);
  assert.equal(hasDisagreement({ annotatorA: 'present', annotatorB: 'exempt' }), true);
});

test('validateAnnotationSet flags unresolved disagreement as a blocking error', () => {
  const set = {
    schemaVersion: ANNOTATION_SCHEMA_VERSION,
    cases: [
      {
        caseId: 'c1',
        benchmark: 'swe-bench-verified',
        taskId: 't1',
        success: true,
        annotations: {
          ghostContext: { annotatorA: 'present', annotatorB: 'absent' },
        },
      },
    ],
  };

  const { errors } = validateAnnotationSet(set);
  assert.ok(errors.some((issue) => /no adjudicated label/.test(issue.message)));
});

test('validateAnnotationSet rejects unknown defect keys and duplicate caseIds', () => {
  const set = {
    schemaVersion: ANNOTATION_SCHEMA_VERSION,
    cases: [
      {
        caseId: 'dup',
        benchmark: 'terminal-bench',
        taskId: 't1',
        success: true,
        annotations: { notARealDefect: { annotatorA: 'absent', annotatorB: 'absent' } },
      },
      {
        caseId: 'dup',
        benchmark: 'terminal-bench',
        taskId: 't2',
        success: false,
        annotations: {},
      },
    ],
  };

  const { errors } = validateAnnotationSet(set);
  assert.ok(errors.some((issue) => /Unknown defect key/.test(issue.message)));
  assert.ok(errors.some((issue) => /Duplicate caseId/.test(issue.message)));
});

test('validateAnnotationSet rejects a mismatched schema version', () => {
  const { errors } = validateAnnotationSet({ schemaVersion: 'something-else', cases: [] });
  assert.ok(errors.some((issue) => /Unexpected schemaVersion/.test(issue.message)));
});

test('flattenAnnotationSet emits one row per case-defect pair and skips unresolved rows', () => {
  const set = {
    schemaVersion: ANNOTATION_SCHEMA_VERSION,
    cases: [
      {
        caseId: 'c1',
        benchmark: 'android-bench',
        taskId: 't1',
        success: true,
        annotations: {
          ghostContext: { annotatorA: 'present', annotatorB: 'present', evidence: 'e' },
          deadStep: { annotatorA: 'present', annotatorB: 'absent', adjudicated: 'present', evidence: 'e' },
          longChain: { annotatorA: 'present', annotatorB: 'absent' },
        },
      },
    ],
  };

  const rows = flattenAnnotationSet(set);
  assert.equal(rows.length, 2, 'the unresolved longChain row must be skipped');

  const ghost = rows.find((row) => row.defect === 'ghostContext');
  assert.equal(ghost.label, true);
  assert.equal(ghost.adjudicated, false);

  const dead = rows.find((row) => row.defect === 'deadStep');
  assert.equal(dead.label, true);
  assert.equal(dead.adjudicated, true);
});

test('loadAnnotationSet gives an actionable error when the file is absent', () => {
  assert.throws(
    () => loadAnnotationSet(path.join(os.tmpdir(), `missing-annotations-${Date.now()}.json`)),
    /does not ship annotation data/
  );
});

test('loadAnnotationSet round-trips a written set', () => {
  const filePath = path.join(os.tmpdir(), `annotations-${Date.now()}.json`);
  fs.writeFileSync(
    filePath,
    JSON.stringify({
      schemaVersion: ANNOTATION_SCHEMA_VERSION,
      cases: [makeCase(1, 'swe-bench-verified', true, 'present')],
    }),
    'utf-8'
  );

  try {
    const loaded = loadAnnotationSet(filePath);
    assert.equal(loaded.caseCount, 1);
    assert.deepEqual(loaded.errors, []);
    assert.equal(loaded.coverageByDefect.ghostContext, 1);
  } finally {
    fs.unlinkSync(filePath);
  }
});

test('defaultStratumKey combines benchmark with the outcome bucket', () => {
  assert.equal(
    defaultStratumKey({ benchmark: 'terminal-bench', success: true }),
    'terminal-bench|success'
  );
  assert.equal(
    defaultStratumKey({ benchmark: 'terminal-bench', success: false }),
    'terminal-bench|failure'
  );
  assert.equal(
    defaultStratumKey({ benchmark: 'terminal-bench', success: null }),
    'terminal-bench|unknown'
  );
});

test('splitAnnotatedCases reproduces the paper 80/40/80 partition on 200 cases', () => {
  const cases = [];
  // 100 SWE / 40 Android / 60 Terminal，各来源内成败对半
  const composition = [
    ['swe-bench-verified', 100],
    ['android-bench', 40],
    ['terminal-bench', 60],
  ];
  let index = 0;
  for (const [benchmark, count] of composition) {
    for (let taken = 0; taken < count; taken++) {
      cases.push(makeCase(index++, benchmark, taken % 2 === 0));
    }
  }
  assert.equal(cases.length, 200);

  const result = splitAnnotatedCases(cases, { seed: 42 });
  assert.equal(result.counts.development, PAPER_SPLIT_SIZES.development);
  assert.equal(result.counts.calibration, PAPER_SPLIT_SIZES.calibration);
  assert.equal(result.counts.evaluation, PAPER_SPLIT_SIZES.evaluation);
  assert.deepEqual(result.notes, [], 'an exactly sized set needs no rescaling note');

  // 每个样本恰好落在一个划分
  assert.equal(Object.keys(result.splitByCaseId).length, 200);
});

test('splitAnnotatedCases is deterministic per seed and varies across seeds', () => {
  const cases = Array.from({ length: 60 }, (_, index) =>
    makeCase(index, index % 2 === 0 ? 'android-bench' : 'terminal-bench', index % 3 !== 0)
  );

  const a = splitAnnotatedCases(cases, { seed: 7, sizes: { development: 24, calibration: 12, evaluation: 24 } });
  const b = splitAnnotatedCases(cases, { seed: 7, sizes: { development: 24, calibration: 12, evaluation: 24 } });
  const c = splitAnnotatedCases(cases, { seed: 8, sizes: { development: 24, calibration: 12, evaluation: 24 } });

  assert.deepEqual(a.splitByCaseId, b.splitByCaseId, 'same seed must reproduce the split');
  assert.notDeepEqual(a.splitByCaseId, c.splitByCaseId, 'a different seed should reshuffle');
});

test('splitAnnotatedCases keeps every stratum represented in each split', () => {
  const cases = [];
  let index = 0;
  for (const benchmark of ['android-bench', 'terminal-bench', 'swe-bench-verified']) {
    for (let taken = 0; taken < 20; taken++) {
      cases.push(makeCase(index++, benchmark, taken % 2 === 0));
    }
  }

  const result = splitAnnotatedCases(cases, {
    seed: 3,
    sizes: { development: 24, calibration: 12, evaluation: 24 },
  });

  // 3 来源 x 2 成败 = 6 个分层，每个划分都应覆盖全部分层
  for (const split of ['development', 'calibration', 'evaluation']) {
    assert.equal(
      Object.keys(result.stratumCounts[split]).length,
      6,
      `split ${split} lost a stratum`
    );
  }
});

test('splitAnnotatedCases records a note when the set size differs from the target', () => {
  const cases = Array.from({ length: 50 }, (_, index) => makeCase(index, 'android-bench', true));
  const result = splitAnnotatedCases(cases, { seed: 1 });
  assert.equal(result.assignments.length, 50);
  assert.ok(result.notes.some((note) => /rescaled proportionally/.test(note)));
});

test('assertSplitDiscipline catches leakage across splits', () => {
  const splitByCaseId = { a: 'development', b: 'calibration', c: 'evaluation' };

  assert.deepEqual(
    assertSplitDiscipline(splitByCaseId, {
      thresholdTuningCaseIds: ['a'],
      calibrationFittingCaseIds: ['b'],
      finalEvaluationCaseIds: ['c'],
    }),
    []
  );

  const violations = assertSplitDiscipline(splitByCaseId, {
    thresholdTuningCaseIds: ['a', 'c'],
    calibrationFittingCaseIds: ['a'],
  });
  assert.equal(violations.length, 2);
  assert.equal(violations[0].stage, 'threshold-tuning');
  assert.deepEqual(violations[0].offendingCaseIds, ['c']);
  assert.equal(violations[1].stage, 'calibration-fitting');
});
