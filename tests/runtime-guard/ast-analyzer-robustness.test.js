const test = require('node:test');
const assert = require('node:assert/strict');

const { AstAnalyzer } = require('../../dist/src/analyzers/AstAnalyzer.js');

test('AstAnalyzer falls back safely on oversized inputs', () => {
  const analyzer = new AstAnalyzer();
  const hugeCode = `function giantFunction() { return 1; }\n${'const x = 1;\n'.repeat(20000)}`;
  const symbols = analyzer.extractSymbols(hugeCode, { filePath: 'example.js' });

  assert.ok(symbols.functions.includes('giantFunction'));
});
