const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  choosePreferredTranscriptPath,
  createSeededRandom,
  findEnclosingPythonDefinition,
  runVerificationPlan,
  resolveVerificationPlan,
  selectRandomQuestions,
} = require('../../dist/src/benchmark/SweBenchVerifiedSmoke.js');

test('selectRandomQuestions is deterministic for a fixed seed', () => {
  const questions = [
    { instance_id: 'one' },
    { instance_id: 'two' },
    { instance_id: 'three' },
    { instance_id: 'four' },
  ];

  const first = selectRandomQuestions(questions, 2, 1234).map((item) => item.instance_id);
  const second = selectRandomQuestions(questions, 2, 1234).map((item) => item.instance_id);
  const third = selectRandomQuestions(questions, 2, 5678).map((item) => item.instance_id);

  assert.deepEqual(first, second);
  assert.notDeepEqual(first, third);
});

test('findEnclosingPythonDefinition returns the surrounding class and function', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'procbench-python-def-'));
  const filePath = path.join(tempDir, 'tests', 'sample.py');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    [
      'class SampleTests:',
      '    def test_escape(self):',
      '        """Helpful label"""',
      '        assert True',
      '',
    ].join('\n'),
    'utf-8'
  );

  const located = findEnclosingPythonDefinition(filePath, 3);
  assert.deepEqual(located, {
    className: 'SampleTests',
    functionName: 'test_escape',
  });
});

test('resolveVerificationPlan supports plain pytest function names', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'procbench-pytest-plan-'));
  const filePath = path.join(tempDir, 'sympy', 'core', 'tests', 'test_issue.py');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    [
      'def test_issue_11617():',
      '    assert True',
      '',
    ].join('\n'),
    'utf-8'
  );

  const plan = resolveVerificationPlan(
    {
      repo: 'sympy/sympy',
      instance_id: 'sympy__sympy-11618',
      FAIL_TO_PASS: ['test_issue_11617'],
      PASS_TO_PASS: [],
    },
    tempDir,
    'python3'
  );

  assert.equal(plan.runner, 'pytest');
  assert.deepEqual(plan.failToPassTargets, ['sympy/core/tests/test_issue.py::test_issue_11617']);
  assert.deepEqual(plan.unresolvedLabels, []);
});

test('resolveVerificationPlan converts django docstring labels into runtests targets', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'procbench-django-plan-'));
  const filePath = path.join(
    tempDir,
    'tests',
    'template_tests',
    'filter_tests',
    'test_html.py'
  );
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    [
      'class TestUtilsHtml:',
      '    def test_escape(self):',
      '        """A plain text label"""',
      '        assert True',
      '',
    ].join('\n'),
    'utf-8'
  );

  const plan = resolveVerificationPlan(
    {
      repo: 'django/django',
      instance_id: 'django__django-11276',
      FAIL_TO_PASS: ['A plain text label'],
      PASS_TO_PASS: ['test_escape (template_tests.filter_tests.test_html.TestUtilsHtml)'],
    },
    tempDir,
    'python3'
  );

  assert.equal(plan.runner, 'django');
  assert.deepEqual(plan.failToPassTargets, [
    'template_tests.filter_tests.test_html.TestUtilsHtml.test_escape',
  ]);
  assert.deepEqual(plan.passToPassTargets, [
    'template_tests.filter_tests.test_html.TestUtilsHtml.test_escape',
  ]);
  assert.deepEqual(plan.unresolvedLabels, []);
});

test('resolveVerificationPlan tolerates normalized django prose labels', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'procbench-django-prose-'));
  const filePath = path.join(tempDir, 'tests', 'migrations', 'test_operations.py');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    [
      'class OperationTests:',
      '    def test_alter_field_pk_fk_db_collation(self):',
      '        """Tests the AlterField operation on primary keys changes any FKs pointing to it."""',
      '        assert True',
      '',
    ].join('\n'),
    'utf-8'
  );

  const plan = resolveVerificationPlan(
    {
      repo: 'django/django',
      instance_id: 'django__django-15629',
      FAIL_TO_PASS: ['AlterField operation of db_collation on primary keys changes any FKs'],
      PASS_TO_PASS: [],
    },
    tempDir,
    'python3'
  );

  assert.deepEqual(plan.failToPassTargets, [
    'migrations.test_operations.OperationTests.test_alter_field_pk_fk_db_collation',
  ]);
  assert.deepEqual(plan.unresolvedLabels, []);
});

test('resolveVerificationPlan does not treat django issue suffixes as module hints', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'procbench-django-issue-suffix-'));
  const filePath = path.join(tempDir, 'tests', 'migrations', 'test_operations.py');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    [
      'class OperationTests:',
      '    def test_alter_fk_non_fk(self):',
      '        """Altering an FK to a non-FK works (#23244)"""',
      '        assert True',
      '',
      '    def test_alter_model_options_emptying(self):',
      '        """The AlterModelOptions operation removes keys from the dict (#23121)"""',
      '        assert True',
      '',
    ].join('\n'),
    'utf-8'
  );

  const plan = resolveVerificationPlan(
    {
      repo: 'django/django',
      instance_id: 'django__django-15629-issues',
      FAIL_TO_PASS: [
        'Altering an FK to a non-FK works (#23244)',
        'The AlterModelOptions operation removes keys from the dict (#23121)',
      ],
      PASS_TO_PASS: [],
    },
    tempDir,
    'python3'
  );

  assert.deepEqual(plan.failToPassTargets, [
    'migrations.test_operations.OperationTests.test_alter_fk_non_fk',
    'migrations.test_operations.OperationTests.test_alter_model_options_emptying',
  ]);
  assert.deepEqual(plan.unresolvedLabels, []);
});

test('resolveVerificationPlan applies django prose overrides for db_collation regression labels', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'procbench-django-collation-'));
  const migrationsFile = path.join(tempDir, 'tests', 'migrations', 'test_operations.py');
  const schemaFile = path.join(tempDir, 'tests', 'schema', 'tests.py');
  const foreignKeyFile = path.join(tempDir, 'tests', 'model_fields', 'test_foreignkey.py');
  fs.mkdirSync(path.dirname(migrationsFile), { recursive: true });
  fs.mkdirSync(path.dirname(schemaFile), { recursive: true });
  fs.mkdirSync(path.dirname(foreignKeyFile), { recursive: true });
  fs.writeFileSync(
    migrationsFile,
    [
      'class OperationTests:',
      '    def test_alter_field_pk_fk(self):',
      '        assert True',
      '',
    ].join('\n'),
    'utf-8'
  );
  fs.writeFileSync(
    schemaFile,
    [
      'class SchemaTests:',
      '    def test_relation_fields_db_collation(self):',
      '        assert True',
      '',
    ].join('\n'),
    'utf-8'
  );
  fs.writeFileSync(
    foreignKeyFile,
    [
      'class ForeignKeyTests:',
      '    def test_db_parameters_propagate_target_field_collation(self):',
      '        assert True',
      '',
    ].join('\n'),
    'utf-8'
  );

  const plan = resolveVerificationPlan(
    {
      repo: 'django/django',
      instance_id: 'django__django-15629-collation',
      FAIL_TO_PASS: [
        'AlterField operation of db_collation on primary keys changes any FKs',
        'Creation of models with a FK to a PK with db_collation.',
      ],
      PASS_TO_PASS: [],
    },
    tempDir,
    'python3'
  );

  assert.deepEqual(plan.failToPassTargets, [
    'migrations.test_operations.OperationTests.test_alter_field_pk_fk',
    'schema.tests.SchemaTests.test_relation_fields_db_collation',
    'model_fields.test_foreignkey.ForeignKeyTests.test_db_parameters_propagate_target_field_collation',
  ]);
  assert.deepEqual(plan.unresolvedLabels, []);
});

test('resolveVerificationPlan remaps stale django named labels to current test methods', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'procbench-django-renamed-'));
  const modelFormsTests = path.join(tempDir, 'tests', 'model_forms', 'tests.py');
  const modelChoiceTests = path.join(
    tempDir,
    'tests',
    'model_forms',
    'test_modelchoicefield.py'
  );
  fs.mkdirSync(path.dirname(modelFormsTests), { recursive: true });
  fs.writeFileSync(
    modelFormsTests,
    [
      'class ModelFormBaseTest:',
      '    def test_blank_foreign_key_with_radio(self):',
      '        assert True',
      '',
      '    def test_blank_false_radio_select_with_null_true_foreign_key_field(self):',
      '        assert True',
      '',
    ].join('\n'),
    'utf-8'
  );
  fs.writeFileSync(
    modelChoiceTests,
    [
      'class ModelChoiceFieldTests:',
      '    def test_radio_choices_with_blank(self):',
      '        assert True',
      '',
      '    def test_clean_model_instance(self):',
      '        assert True',
      '',
    ].join('\n'),
    'utf-8'
  );

  const plan = resolveVerificationPlan(
    {
      repo: 'django/django',
      instance_id: 'django__django-12406',
      FAIL_TO_PASS: [
        'test_non_blank_foreign_key_with_radio (model_forms.tests.ModelFormBaseTest)',
        'test_choices_radio_blank (model_forms.test_modelchoicefield.ModelChoiceFieldTests)',
        'test_clean_model_instance (model_forms.test_modelchoicefield.ModelChoiceFieldTests)',
      ],
      PASS_TO_PASS: [],
    },
    tempDir,
    'python3'
  );

  assert.deepEqual(plan.failToPassTargets, [
    'model_forms.tests.ModelFormBaseTest.test_blank_false_radio_select_with_null_true_foreign_key_field',
    'model_forms.test_modelchoicefield.ModelChoiceFieldTests.test_radio_choices_with_blank',
    'model_forms.test_modelchoicefield.ModelChoiceFieldTests.test_clean_model_instance',
  ]);
  assert.deepEqual(plan.unresolvedLabels, []);
});

test('resolveVerificationPlan resolves unique django prose docstrings before fuzzy fallback', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'procbench-django-docstring-'));
  const filePath = path.join(tempDir, 'tests', 'model_forms', 'tests.py');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    [
      'class FormFieldCallbackTests:',
      '    def test_custom_callback(self):',
      '        """A custom formfield_callback is used if provided"""',
      '        assert True',
      '',
    ].join('\n'),
    'utf-8'
  );

  const plan = resolveVerificationPlan(
    {
      repo: 'django/django',
      instance_id: 'django__django-docstring',
      FAIL_TO_PASS: ['A custom formfield_callback is used if provided'],
      PASS_TO_PASS: [],
    },
    tempDir,
    'python3'
  );

  assert.deepEqual(plan.failToPassTargets, [
    'model_forms.tests.FormFieldCallbackTests.test_custom_callback',
  ]);
  assert.deepEqual(plan.unresolvedLabels, []);
});

test('resolveVerificationPlan expands duplicated django prose labels to all matching tests', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'procbench-django-duplicate-'));
  const filePath = path.join(tempDir, 'tests', 'model_forms', 'tests.py');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    [
      'class ModelFormFactoryTests:',
      '    def test_without_fields(self):',
      '        """Regression for #19733"""',
      '        assert True',
      '',
      '    def test_with_all_fields(self):',
      '        """Regression for #19733"""',
      '        assert True',
      '',
    ].join('\n'),
    'utf-8'
  );

  const plan = resolveVerificationPlan(
    {
      repo: 'django/django',
      instance_id: 'django__django-duplicate',
      FAIL_TO_PASS: ['Regression for #19733'],
      PASS_TO_PASS: [],
    },
    tempDir,
    'python3'
  );

  assert.deepEqual(plan.failToPassTargets, [
    'model_forms.tests.ModelFormFactoryTests.test_without_fields',
    'model_forms.tests.ModelFormFactoryTests.test_with_all_fields',
  ]);
  assert.deepEqual(plan.unresolvedLabels, []);
});

test('runVerificationPlan injects project root into PYTHONPATH for django runtests', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'procbench-django-env-'));
  const djangoPkgDir = path.join(tempDir, 'django');
  const testsDir = path.join(tempDir, 'tests');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(djangoPkgDir, { recursive: true });
  fs.mkdirSync(testsDir, { recursive: true });
  fs.writeFileSync(path.join(djangoPkgDir, '__init__.py'), '__all__ = []\n', 'utf-8');
  fs.writeFileSync(
    path.join(testsDir, 'runtests.py'),
    [
      'import django',
      'import sys',
      'assert django.__all__ == []',
      'print("ok", " ".join(sys.argv[1:]))',
      '',
    ].join('\n'),
    'utf-8'
  );

  const plan = {
    runner: 'django',
    failToPassTargets: ['suite.SampleTests.test_case'],
    passToPassTargets: [],
    unresolvedLabels: [],
    commandPrefix: ['python3', 'tests/runtests.py', '--parallel', '1'],
  };

  const summary = runVerificationPlan(
    plan,
    tempDir,
    outputDir,
    { repo: 'django/django', instance_id: 'django__django-smoke' },
    30
  );

  assert.equal(summary.success, true);
  assert.equal(summary.commands.length, 1);
  assert.equal(summary.commands[0].exitCode, 0);
  assert.match(fs.readFileSync(summary.commands[0].stdoutPath, 'utf-8'), /suite\.SampleTests\.test_case/);
});

test('choosePreferredTranscriptPath prefers codex rollout files', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'procbench-transcript-'));
  const runDir = path.join(tempDir, 'run');
  const jsonlDir = path.join(runDir, 'jsonl');
  const sessionDir = path.join(runDir, '.codex-home', 'sessions', '2026', '04', '28');
  fs.mkdirSync(jsonlDir, { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  const historyPath = path.join(jsonlDir, 'history.jsonl');
  const rolloutPath = path.join(sessionDir, 'rollout-sample.jsonl');

  fs.writeFileSync(historyPath, '{"id":"resp_1"}\n', 'utf-8');
  fs.writeFileSync(
    rolloutPath,
    '{"timestamp":"2026-04-28T00:00:00.000Z","type":"session_meta","payload":{"id":"sample"}}\n',
    'utf-8'
  );

  const picked = choosePreferredTranscriptPath(runDir, {
    copied_jsonl: [historyPath, rolloutPath],
  });

  assert.equal(picked, rolloutPath);
});
