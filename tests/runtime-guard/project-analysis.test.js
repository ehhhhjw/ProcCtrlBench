const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

test('build-file-graph preserves native tree-sitter project analysis across worker batches', () => {
  const repoRoot = path.resolve(__dirname, '../..');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analysis-test-'));
  const projectDir = path.join(tempDir, 'project');
  const outputDir = path.join(tempDir, 'output');
  const configPath = path.join(tempDir, 'project-analysis.json');

  try {
    writeFile(
      path.join(projectDir, 'src/shared.ts'),
      [
        'export function sharedThing(value: number) {',
        '  return value + 1;',
        '}',
        '',
      ].join('\n')
    );
    writeFile(
      path.join(projectDir, 'src/feature/user-a.ts'),
      [
        "import { sharedThing } from '../shared';",
        '',
        'export function useSharedA() {',
        '  return sharedThing(1);',
        '}',
        '',
      ].join('\n')
    );
    writeFile(
      path.join(projectDir, 'src/feature/user-b.ts'),
      [
        "import { sharedThing } from '../shared';",
        '',
        'export function useSharedB() {',
        '  return sharedThing(2);',
        '}',
        '',
      ].join('\n')
    );
    writeFile(
      path.join(projectDir, 'src/feature/nested/helper.ts'),
      [
        'export function helperThing() {',
        "  return 'ok';",
        '}',
        '',
      ].join('\n')
    );
    writeFile(
      path.join(projectDir, 'src/feature/nested/consumer.ts'),
      [
        "import { helperThing } from './helper';",
        "import { sharedThing } from '../../shared';",
        '',
        'export function consumeBoth() {',
        '  return `${helperThing()}-${sharedThing(3)}`;',
        '}',
        '',
      ].join('\n')
    );
    writeFile(
      path.join(projectDir, 'src/feature/nested/leaf.ts'),
      [
        "import { consumeBoth } from './consumer';",
        '',
        'export function leaf() {',
        '  return consumeBoth();',
        '}',
        '',
      ].join('\n')
    );

    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          projectPath: projectDir,
          outputDir,
          includeExtensions: ['.ts'],
          excludeDirs: [],
          enableSymbolRelations: true,
          outputFiles: {
            fileGraph: 'file-graph.json',
            projectAst: 'project-ast.json',
          },
        },
        null,
        2
      ),
      'utf-8'
    );

    const run = spawnSync(
      process.execPath,
      [
        require.resolve('ts-node/dist/bin.js'),
        '--transpile-only',
        '-O',
        JSON.stringify({
          types: ['node', './src/types/externals.d.ts'],
          skipLibCheck: true,
        }),
        path.join(repoRoot, 'scripts/build-file-graph.ts'),
        configPath,
      ],
      {
        cwd: repoRoot,
        encoding: 'utf-8',
        env: {
          ...process.env,
          PROJECT_ANALYSIS_BATCH_MAX_FILES: '2',
          PROJECT_ANALYSIS_BATCH_MAX_BYTES: '2048',
        },
      }
    );

    assert.equal(run.status, 0, run.stderr || run.stdout);

    const fileGraph = JSON.parse(fs.readFileSync(path.join(outputDir, 'file-graph.json'), 'utf-8'));
    const projectAst = JSON.parse(fs.readFileSync(path.join(outputDir, 'project-ast.json'), 'utf-8'));

    assert.equal(projectAst.summary.totalFiles, 6);
    assert.deepEqual(fileGraph['src/feature/user-a.ts'], ['src/shared.ts']);
    assert.deepEqual(fileGraph['src/feature/user-b.ts'], ['src/shared.ts']);
    assert.deepEqual(fileGraph['src/feature/nested/leaf.ts'], ['src/feature/nested/consumer.ts']);
    assert.deepEqual(
      fileGraph['src/feature/nested/consumer.ts'],
      ['src/feature/nested/helper.ts', 'src/shared.ts']
    );

    const sharedFile = projectAst.files.find((file) => file.relativePath === 'src/shared.ts');
    assert.ok(sharedFile);
    assert.ok(sharedFile.symbols.functions.includes('sharedThing'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('build-file-graph resolves Java imports alongside Python files in mixed-language projects', () => {
  const repoRoot = path.resolve(__dirname, '../..');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analysis-java-test-'));
  const projectDir = path.join(tempDir, 'project');
  const outputDir = path.join(tempDir, 'output');
  const configPath = path.join(tempDir, 'project-analysis.json');

  try {
    writeFile(
      path.join(projectDir, 'python', 'util.py'),
      [
        'def shared_value():',
        '    return 42',
        '',
      ].join('\n')
    );
    writeFile(
      path.join(projectDir, 'src', 'com', 'demo', 'Helper.java'),
      [
        'package com.demo;',
        '',
        'public class Helper {',
        '  public static int inc(int value) {',
        '    return value + 1;',
        '  }',
        '}',
        '',
      ].join('\n')
    );
    writeFile(
      path.join(projectDir, 'src', 'com', 'demo', 'Main.java'),
      [
        'package com.demo;',
        '',
        'import com.demo.Helper;',
        '',
        'public class Main {',
        '  public int run() {',
        '    return Helper.inc(1);',
        '  }',
        '}',
        '',
      ].join('\n')
    );

    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          projectPath: projectDir,
          outputDir,
          includeExtensions: ['.py', '.java'],
          excludeDirs: [],
          enableSymbolRelations: false,
          outputFiles: {
            fileGraph: 'file-graph.json',
            projectAst: 'project-ast.json',
          },
        },
        null,
        2
      ),
      'utf-8'
    );

    const run = spawnSync(
      process.execPath,
      [
        require.resolve('ts-node/dist/bin.js'),
        '--transpile-only',
        '-O',
        JSON.stringify({
          types: ['node', './src/types/externals.d.ts'],
          skipLibCheck: true,
        }),
        path.join(repoRoot, 'scripts/build-file-graph.ts'),
        configPath,
      ],
      {
        cwd: repoRoot,
        encoding: 'utf-8',
      }
    );

    assert.equal(run.status, 0, run.stderr || run.stdout);

    const fileGraph = JSON.parse(fs.readFileSync(path.join(outputDir, 'file-graph.json'), 'utf-8'));
    const projectAst = JSON.parse(fs.readFileSync(path.join(outputDir, 'project-ast.json'), 'utf-8'));

    assert.deepEqual(fileGraph['src/com/demo/Main.java'], ['src/com/demo/Helper.java']);
    assert.equal(projectAst.summary.languages.java, 2);
    assert.equal(projectAst.summary.languages.python, 1);

    const mainFile = projectAst.files.find((file) => file.relativePath === 'src/com/demo/Main.java');
    assert.ok(mainFile);
    assert.deepEqual(mainFile.symbols.imports, ['com.demo.Helper']);
    assert.deepEqual(mainFile.resolvedImports, ['src/com/demo/Helper.java']);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
