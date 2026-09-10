import * as fs from 'fs';
import * as path from 'path';
import { writePrewarn } from '../src/utils/Prewarn';
import { AstAnalyzer } from '../src/analyzers/AstAnalyzer';
import { FileAssociationLoader } from '../src/analyzers/FileAssociationLoader';
import { ProjectAstLoader } from '../src/analyzers/ProjectAstLoader';

async function testPrewarn() {
  const out = path.join(process.cwd(), 'output');
  const file = path.join(out, 'prewarn.json');
  if (fs.existsSync(file)) fs.unlinkSync(file);
  writePrewarn({ metric: 'unit', message: 'test prewarn', details: { ok: true } });
  if (!fs.existsSync(file)) throw new Error('prewarn.json not created');
  const arr = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (!Array.isArray(arr) || arr.length < 1) throw new Error('prewarn.json empty');
  console.log('[ok] prewarn write');
}

async function testAstSymbols() {
  const code = `
    import { X } from './mod';
    class A { m(){} }
    function f(){}
  `;
  const ast = new AstAnalyzer();
  await ast.init();
  const syms = ast.extractSymbols(code);
  if (syms.classes.indexOf('A') === -1) throw new Error('class not found');
  console.log('[ok] ast symbols');
}

function testFileGraphLoader() {
  const file = path.join(process.cwd(), 'output', 'file-graph.json');
  if (!fs.existsSync(file)) throw new Error('file-graph.json missing; run build-file-graph.ts first');
  const loader = new FileAssociationLoader(file);
  loader.load();
  const any = loader.get('detectors/DeadStepDetector.ts');
  if (!Array.isArray(any)) throw new Error('association not array');
  console.log('[ok] file graph loader');
}

function testProjectAstLoader() {
  const file = path.join(process.cwd(), 'output', 'project-ast.json');
  if (!fs.existsSync(file)) throw new Error('project-ast.json missing; run build-file-graph.ts first');
  const loader = new ProjectAstLoader(file);
  loader.load();
  const root = loader.getProjectRoot();
  if (!root) throw new Error('project root missing');
  console.log('[ok] project ast loader');
}

async function main() {
  await testPrewarn();
  await testAstSymbols();
  testFileGraphLoader();
  testProjectAstLoader();
  console.log('All tests passed');
}

main().catch(e => { console.error('Tests failed:', e); process.exit(1); });
