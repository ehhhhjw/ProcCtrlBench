import type {
  FileRelation,
  ProjectAnalysisConfig,
  ProjectAnalysisResult,
  ProjectFileAnalysis,
  ProjectAnalysisSummary,
} from '../types/project-analysis.types';

export type SupportedLanguage =
  | 'typescript'
  | 'tsx'
  | 'javascript'
  | 'python'
  | 'java'
  | 'cpp'
  | 'csharp'
  | 'unknown';

export interface AstExtractOptions {
  filePath?: string;
  language?: SupportedLanguage | string;
}

export interface SymbolLocation {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface FunctionSymbolInfo {
  name: string;
  kind: 'function' | 'method';
  language: SupportedLanguage;
  parentClass?: string;
  parameters: string[];
  calls: string[];
  location: SymbolLocation;
}

export interface PropertySymbolInfo {
  name: string;
  kind: 'class_field' | 'property_assignment' | 'object_property' | 'variable';
  language: SupportedLanguage;
  parentClass?: string;
  parentFunction?: string;
  location: SymbolLocation;
}

export interface ClassSymbolInfo {
  name: string;
  language: SupportedLanguage;
  methods: string[];
  properties: string[];
  location: SymbolLocation;
}

export interface ExtractedSymbols {
  language: SupportedLanguage;
  classes: string[];
  functions: string[];
  methods: string[];
  properties: string[];
  imports: string[];
  variables: string[];
  calls: string[];
  classDetails: ClassSymbolInfo[];
  functionDetails: FunctionSymbolInfo[];
  propertyDetails: PropertySymbolInfo[];
}

interface ParseCandidate {
  language: SupportedLanguage;
  tree: any;
  score: number;
}

interface WalkState {
  language: SupportedLanguage;
  result: ExtractedSymbols;
  classStack: ClassSymbolInfo[];
  functionStack: FunctionSymbolInfo[];
  detailKeys: Set<string>;
}

const MAX_TREE_SITTER_INPUT_CHARS = 120_000;

/**
 * 基于 tree-sitter 的多语言符号抽取器。
 * 默认支持 TS/TSX/JS/Python/Java/C++/C#，粒度覆盖类、函数、方法、属性、变量、导入和调用点。
 */
export class AstAnalyzer {
  private parsers = new Map<SupportedLanguage, any>();
  private initializationAttempted = false;

  async init(): Promise<void> {
    this.ensureInitialized();
  }

  /**
   * 兼容旧接口，同时返回更细粒度的符号结果。
   */
  extractSymbols(code: string, options: AstExtractOptions = {}): ExtractedSymbols {
    this.ensureInitialized();

    if (!code || !code.trim()) {
      return this.createEmptyResult('unknown');
    }

    // Large tool outputs and pasted source blobs can destabilize native parsers in batch runs.
    // For these cases, a regex fallback is less precise but much more robust.
    if (code.length > MAX_TREE_SITTER_INPUT_CHARS) {
      return this.extractWithRegexFallback(code, options.filePath);
    }

    const parsed = this.parseBestCandidate(code, options);
    if (!parsed) {
      return this.extractWithRegexFallback(code, options.filePath);
    }

    try {
      return this.collectSymbols(parsed.tree.rootNode, parsed.language);
    } catch {
      return this.extractWithRegexFallback(code, options.filePath);
    }
  }

  analyzeProject(
    projectPath: string,
    config: Pick<ProjectAnalysisConfig, 'includeExtensions' | 'excludeDirs' | 'enableSymbolRelations' | 'relatedFilesDataPath'>
  ): ProjectAnalysisResult {
    this.ensureInitialized();

    const path = require('path') as typeof import('path');
    const resolvedProjectPath = path.resolve(projectPath);
    const files = this.collectProjectFiles(resolvedProjectPath, config.includeExtensions, config.excludeDirs);
    const analyzedFiles = this.analyzeProjectFiles(resolvedProjectPath, files);

    return this.buildProjectAnalysisResult(resolvedProjectPath, analyzedFiles, config);
  }

  analyzeProjectFiles(projectPath: string, filePaths: string[]): ProjectFileAnalysis[] {
    this.ensureInitialized();

    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const resolvedProjectPath = path.resolve(projectPath);
    const normalizedPaths = Array.from(
      new Set(filePaths.map((filePath) => path.resolve(filePath)))
    ).sort((a, b) => a.localeCompare(b));

    return normalizedPaths.map((filePath) => {
      const code = fs.readFileSync(filePath, 'utf-8');
      const symbols = this.extractSymbols(code, { filePath });
      return {
        filePath,
        relativePath: this.normalizeRelativePath(path.relative(resolvedProjectPath, filePath)),
        language: symbols.language,
        symbols,
        importedModules: [...symbols.imports],
        resolvedImports: [],
        relations: [],
      };
    });
  }

  buildProjectAnalysisResult(
    projectPath: string,
    analyzedFiles: ProjectFileAnalysis[],
    config: Pick<ProjectAnalysisConfig, 'includeExtensions' | 'excludeDirs' | 'enableSymbolRelations' | 'relatedFilesDataPath'>
  ): ProjectAnalysisResult {
    this.ensureInitialized();

    const path = require('path') as typeof import('path');
    const resolvedProjectPath = path.resolve(projectPath);
    const normalizedFiles = [...analyzedFiles].sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    const byRelativePath = new Map<string, ProjectFileAnalysis>();
    for (const file of normalizedFiles) {
      byRelativePath.set(file.relativePath, file);
    }

    const localModuleIndex = this.buildLocalModuleIndex(normalizedFiles);
    const symbolOwnerIndex = this.buildSymbolOwnerIndex(normalizedFiles);
    const externalRelatedMap = this.loadExternalRelatedFiles(
      config.relatedFilesDataPath,
      resolvedProjectPath,
      byRelativePath,
      localModuleIndex
    );

    for (const file of normalizedFiles) {
      const relationMap = new Map<string, FileRelation>();

      for (const specifier of file.importedModules) {
        const resolvedTargets = this.resolveImportTargets(specifier, file, resolvedProjectPath, byRelativePath, localModuleIndex);
        for (const target of resolvedTargets) {
          const relationType: FileRelation['type'] = this.isIncludeSpecifier(specifier) ? 'include' : 'import';
          const relation = relationMap.get(target) || { target, type: relationType, evidence: [] };
          relation.type = relationType;
          if (!relation.evidence.includes(specifier)) {
            relation.evidence.push(specifier);
          }
          relationMap.set(target, relation);
        }
      }

      if (config.enableSymbolRelations) {
        const usedSymbols = new Set<string>([
          ...file.symbols.calls,
        ]);
        for (const symbol of usedSymbols) {
          const owners = symbolOwnerIndex.get(symbol) || [];
          if (owners.length !== 1) {
            continue;
          }
          for (const owner of owners) {
            if (owner === file.relativePath) {
              continue;
            }
            const existing = relationMap.get(owner);
            if (existing) {
              if (!existing.evidence.includes(symbol)) {
                existing.evidence.push(symbol);
              }
              continue;
            }
            relationMap.set(owner, {
              target: owner,
              type: 'symbol_reference',
              evidence: [symbol],
            });
          }
        }
      }

      for (const target of externalRelatedMap.get(file.relativePath) || []) {
        if (target === file.relativePath) {
          continue;
        }
        const existing = relationMap.get(target);
        if (existing) {
          if (!existing.evidence.includes('relatedFilesDataPath')) {
            existing.evidence.push('relatedFilesDataPath');
          }
          continue;
        }
        relationMap.set(target, {
          target,
          type: 'external_related',
          evidence: ['relatedFilesDataPath'],
        });
      }

      file.relations = Array.from(relationMap.values()).sort((a, b) => a.target.localeCompare(b.target));
      file.resolvedImports = file.relations
        .filter((relation) => relation.type === 'import' || relation.type === 'include')
        .map((relation) => relation.target);
    }

    const fileGraph: Record<string, string[]> = {};
    for (const file of normalizedFiles) {
      fileGraph[file.relativePath] = file.relations.map((relation) => relation.target);
    }

    return {
      projectPath: resolvedProjectPath,
      generatedAt: new Date().toISOString(),
      config: {
        projectPath: resolvedProjectPath,
        outputDir: '',
        includeExtensions: config.includeExtensions,
        excludeDirs: config.excludeDirs,
        enableSymbolRelations: config.enableSymbolRelations,
        relatedFilesDataPath: config.relatedFilesDataPath || '',
        outputFiles: {
          fileGraph: 'file-graph.json',
          projectAst: 'project-ast.json',
        },
      },
      summary: this.buildProjectSummary(normalizedFiles),
      fileGraph,
      files: normalizedFiles,
    };
  }

  private ensureInitialized(): void {
    if (this.initializationAttempted) {
      return;
    }
    this.initializationAttempted = true;

    if (process.env.PROC_BENCH_DISABLE_TREE_SITTER === '1') {
      this.parsers.clear();
      return;
    }

    try {
      const Parser = require('tree-sitter');
      const tsLanguage = require('tree-sitter-typescript');
      const jsLanguage = require('tree-sitter-javascript');
      const pyLanguage = require('tree-sitter-python');
      const javaLanguage = require('tree-sitter-java');
      const cppLanguage = require('tree-sitter-cpp');
      const csharpLanguage = require('tree-sitter-c-sharp');

      this.registerParser(Parser, 'typescript', tsLanguage.typescript);
      this.registerParser(Parser, 'tsx', tsLanguage.tsx);
      this.registerParser(Parser, 'javascript', jsLanguage);
      this.registerParser(Parser, 'python', pyLanguage);
      this.registerParser(Parser, 'java', javaLanguage);
      this.registerParser(Parser, 'cpp', cppLanguage);
      this.registerParser(Parser, 'csharp', csharpLanguage);
    } catch {
      this.parsers.clear();
    }
  }

  private registerParser(ParserCtor: any, language: SupportedLanguage, grammar: any): void {
    if (!grammar) {
      return;
    }
    const parser = new ParserCtor();
    parser.setLanguage(grammar);
    this.parsers.set(language, parser);
  }

  private parseBestCandidate(code: string, options: AstExtractOptions): ParseCandidate | null {
    if (this.parsers.size === 0) {
      return null;
    }

    const explicit = this.normalizeLanguage(options.language);
    if (explicit !== 'unknown') {
      const parsed = this.parseSingleLanguage(code, explicit);
      if (parsed) {
        return parsed;
      }
    }

    const fromPath = this.detectLanguageFromPath(options.filePath);
    if (fromPath !== 'unknown') {
      const parsed = this.parseSingleLanguage(code, fromPath);
      if (parsed) {
        return parsed;
      }
    }

    const candidates = this.getCandidateLanguages(code, options);
    let best: ParseCandidate | null = null;

    for (const language of candidates) {
      const parsed = this.parseSingleLanguage(code, language);
      if (!parsed) {
        continue;
      }
      if (!best || parsed.score < best.score) {
        best = parsed;
      }
      if (parsed.score <= -50) {
        break;
      }
    }

    return best;
  }

  private parseSingleLanguage(code: string, language: SupportedLanguage): ParseCandidate | null {
    const parser = this.parsers.get(language);
    if (!parser) {
      return null;
    }

    try {
      const tree = parser.parse(code);
      const score = this.scoreTree(tree.rootNode);
      return { language, tree, score };
    } catch {
      return null;
    }
  }

  private getCandidateLanguages(code: string, options: AstExtractOptions): SupportedLanguage[] {
    const explicit = this.normalizeLanguage(options.language);
    if (explicit !== 'unknown') {
      return this.uniqueLanguages([
        explicit,
        ...this.getFallbackLanguages(explicit),
      ]);
    }

    const fromPath = this.detectLanguageFromPath(options.filePath);
    if (fromPath !== 'unknown') {
      return this.uniqueLanguages([
        fromPath,
        ...this.getFallbackLanguages(fromPath),
      ]);
    }

    const heuristic = this.detectLanguageFromContent(code);
    return this.uniqueLanguages([
      heuristic,
      ...this.getFallbackLanguages(heuristic),
      'typescript',
      'javascript',
      'python',
      'java',
      'cpp',
      'csharp',
      'tsx',
    ]);
  }

  private getFallbackLanguages(language: SupportedLanguage): SupportedLanguage[] {
    switch (language) {
      case 'typescript':
        return ['tsx', 'javascript'];
      case 'tsx':
        return ['typescript', 'javascript'];
      case 'javascript':
        return ['typescript', 'tsx'];
      case 'python':
        return ['javascript', 'typescript'];
      case 'java':
        return ['cpp', 'csharp'];
      case 'cpp':
        return ['java', 'csharp'];
      case 'csharp':
        return ['java', 'cpp'];
      default:
        return ['typescript', 'javascript', 'python', 'java', 'cpp', 'csharp', 'tsx'];
    }
  }

  private uniqueLanguages(languages: SupportedLanguage[]): SupportedLanguage[] {
    const filtered = languages.filter((language) => language !== 'unknown');
    return Array.from(new Set(filtered));
  }

  private normalizeLanguage(language?: string): SupportedLanguage {
    switch ((language || '').toLowerCase()) {
      case 'ts':
      case 'typescript':
        return 'typescript';
      case 'tsx':
        return 'tsx';
      case 'js':
      case 'javascript':
      case 'jsx':
        return 'javascript';
      case 'py':
      case 'python':
        return 'python';
      case 'java':
        return 'java';
      case 'cpp':
      case 'cc':
      case 'cxx':
      case 'hpp':
      case 'c++':
        return 'cpp';
      case 'cs':
      case 'csharp':
      case 'c#':
        return 'csharp';
      default:
        return 'unknown';
    }
  }

  private detectLanguageFromPath(filePath?: string): SupportedLanguage {
    if (!filePath) {
      return 'unknown';
    }

    const lower = filePath.toLowerCase();
    if (lower.endsWith('.tsx')) return 'tsx';
    if (lower.endsWith('.ts')) return 'typescript';
    if (lower.endsWith('.jsx') || lower.endsWith('.js')) return 'javascript';
    if (lower.endsWith('.py')) return 'python';
    if (lower.endsWith('.java')) return 'java';
    if (lower.endsWith('.cpp') || lower.endsWith('.cc') || lower.endsWith('.cxx') || lower.endsWith('.hpp') || lower.endsWith('.h')) return 'cpp';
    if (lower.endsWith('.cs')) return 'csharp';
    return 'unknown';
  }

  private detectLanguageFromContent(code: string): SupportedLanguage {
    if (/#include\s*[<"]/m.test(code) || /\bstd::|\bnamespace\s+\w+\s*\{/m.test(code)) {
      return 'cpp';
    }
    if (/^\s*using\s+[A-Z][\w.]*\s*;/m.test(code) || /\bnamespace\s+\w+\s*\{/m.test(code) && /\bclass\s+\w+\s*\{/m.test(code)) {
      return 'csharp';
    }
    if (/^\s*def\s+\w+\s*\(/m.test(code) || /^\s*class\s+\w+\s*:/m.test(code)) {
      return 'python';
    }
    if (/^\s*package\s+[\w.]+;/m.test(code) || /\bpublic\s+class\b|\bprivate\s+\w+\s+\w+\s*\(/m.test(code)) {
      return 'java';
    }
    if (/\binterface\s+\w+|\btype\s+\w+\s*=|:\s*[A-Z][A-Za-z0-9_<>,\[\]\s|?]+[=,)\n]/m.test(code)) {
      return 'typescript';
    }
    if (/<[A-Z][A-Za-z0-9]*[\s/>]/.test(code)) {
      return 'tsx';
    }
    return 'javascript';
  }

  private scoreTree(rootNode: any): number {
    let errorCount = 0;
    let missingCount = 0;
    let namedCount = 0;

    const visit = (node: any) => {
      if (!node) {
        return;
      }

      namedCount++;
      if (node.type === 'ERROR') {
        errorCount++;
      }
      if (typeof node.isMissing === 'function' && node.isMissing()) {
        missingCount++;
      }

      for (const child of node.namedChildren || []) {
        visit(child);
      }
    };

    visit(rootNode);
    return errorCount * 1000 + missingCount * 250 - Math.min(namedCount, 500);
  }

  private collectSymbols(rootNode: any, language: SupportedLanguage): ExtractedSymbols {
    const result = this.createEmptyResult(language);
    const state: WalkState = {
      language,
      result,
      classStack: [],
      functionStack: [],
      detailKeys: new Set<string>(),
    };

    this.walk(rootNode, state, null);
    return result;
  }

  private walk(node: any, state: WalkState, parent: any): void {
    if (!node) {
      return;
    }

    const classInfo = this.extractClassNode(node, state.language);
    if (classInfo) {
      this.recordClass(classInfo, state);
      const currentClass = state.result.classDetails[state.result.classDetails.length - 1];
      state.classStack.push(currentClass);
      for (const child of node.namedChildren || []) {
        this.walk(child, state, node);
      }
      state.classStack.pop();
      return;
    }

    const functionInfo = this.extractFunctionNode(node, parent, state);
    if (functionInfo) {
      this.recordFunction(functionInfo, state);
      const currentFunction = state.result.functionDetails[state.result.functionDetails.length - 1];
      state.functionStack.push(currentFunction);
      for (const child of node.namedChildren || []) {
        this.walk(child, state, node);
      }
      state.functionStack.pop();
      return;
    }

    this.recordImport(node, state);
    this.recordProperty(node, parent, state);
    this.recordVariable(node, parent, state);
    this.recordCall(node, state);

    for (const child of node.namedChildren || []) {
      this.walk(child, state, node);
    }
  }

  private extractClassNode(node: any, language: SupportedLanguage): ClassSymbolInfo | null {
    const classTypes = new Set(['class_declaration', 'class_definition', 'class_specifier']);
    if (!classTypes.has(node.type)) {
      return null;
    }

    const name = this.extractDeclaredName(node);
    if (!name) {
      return null;
    }

    return {
      name,
      language,
      methods: [],
      properties: [],
      location: this.getLocation(node),
    };
  }

  private extractFunctionNode(node: any, parent: any, state: WalkState): FunctionSymbolInfo | null {
    const functionTypes = new Set([
      'function_declaration',
      'function_definition',
      'function_item',
      'function_expression',
      'arrow_function',
      'lambda_expression',
      'method_definition',
      'method_declaration',
      'constructor_declaration',
    ]);

    if (!functionTypes.has(node.type)) {
      return null;
    }

    let name = this.extractDeclaredName(node);
    if (!name && (node.type === 'arrow_function' || node.type === 'function_expression' || node.type === 'lambda_expression')) {
      name = this.extractAssignedName(parent);
    }
    if (!name && node.type === 'constructor_declaration' && state.classStack.length > 0) {
      name = state.classStack[state.classStack.length - 1].name;
    }
    if (!name) {
      return null;
    }

    const inClass = state.classStack.length > 0;
    const kind = inClass ? 'method' : 'function';

    return {
      name,
      kind,
      language: state.language,
      parentClass: inClass ? state.classStack[state.classStack.length - 1].name : undefined,
      parameters: this.extractParameters(node),
      calls: [],
      location: this.getLocation(node),
    };
  }

  private recordClass(info: ClassSymbolInfo, state: WalkState): void {
    const key = `class:${info.name}:${info.location.startLine}:${info.location.endLine}`;
    if (state.detailKeys.has(key)) {
      return;
    }
    state.detailKeys.add(key);
    state.result.classDetails.push(info);
    this.pushUnique(state.result.classes, info.name);
  }

  private recordFunction(info: FunctionSymbolInfo, state: WalkState): void {
    const key = `${info.kind}:${info.parentClass || 'global'}:${info.name}:${info.location.startLine}:${info.location.endLine}`;
    if (state.detailKeys.has(key)) {
      return;
    }
    state.detailKeys.add(key);
    state.result.functionDetails.push(info);

    if (info.kind === 'method') {
      this.pushUnique(state.result.methods, info.name);
      const currentClass = state.classStack[state.classStack.length - 1];
      if (currentClass) {
        this.pushUnique(currentClass.methods, info.name);
      }
    } else {
      this.pushUnique(state.result.functions, info.name);
    }
  }

  private recordImport(node: any, state: WalkState): void {
    const importTypes = new Set([
      'import_statement',
      'import_from_statement',
      'import_declaration',
      'using_directive',
      'preproc_include',
    ]);

    if (!importTypes.has(node.type)) {
      return;
    }

    for (const specifier of this.extractImportSpecifiers(node.text || '')) {
      this.pushUnique(state.result.imports, specifier);
    }
  }

  private recordProperty(node: any, parent: any, state: WalkState): void {
    const currentClass = state.classStack[state.classStack.length - 1];
    const currentFunction = state.functionStack[state.functionStack.length - 1];
    const propertyNames: Array<{ name: string; kind: PropertySymbolInfo['kind'] }> = [];

    if (currentClass && !currentFunction) {
      if (
        node.type === 'field_definition' ||
        node.type === 'public_field_definition' ||
        node.type === 'field_declaration' ||
        node.type === 'property_declaration'
      ) {
        for (const name of this.extractDeclaredNames(node)) {
          propertyNames.push({ name, kind: 'class_field' });
        }
      }
      if (node.type === 'assignment') {
        const left = node.leftNode;
        if (left && left.type === 'identifier') {
          propertyNames.push({ name: left.text, kind: 'class_field' });
        }
      }
    }

    if (node.type === 'assignment' || node.type === 'assignment_expression') {
      const memberName = this.extractAssignedMemberName(node.leftNode);
      if (memberName) {
        propertyNames.push({ name: memberName, kind: 'property_assignment' });
      }
    }

    if ((node.type === 'pair' || node.type === 'property_assignment') && !currentClass) {
      const name = this.extractDeclaredName(node);
      if (name) {
        propertyNames.push({ name, kind: 'object_property' });
      }
    }

    for (const item of propertyNames) {
      const detail: PropertySymbolInfo = {
        name: item.name,
        kind: item.kind,
        language: state.language,
        parentClass: currentClass?.name,
        parentFunction: currentFunction?.name,
        location: this.getLocation(node),
      };

      const key = `${detail.kind}:${detail.parentClass || 'global'}:${detail.parentFunction || 'none'}:${detail.name}:${detail.location.startLine}:${detail.location.endLine}`;
      if (state.detailKeys.has(key)) {
        continue;
      }
      state.detailKeys.add(key);
      state.result.propertyDetails.push(detail);
      this.pushUnique(state.result.properties, detail.name);
      if (currentClass) {
        this.pushUnique(currentClass.properties, detail.name);
      }
    }
  }

  private recordVariable(node: any, parent: any, state: WalkState): void {
    if (state.classStack.length > 0) {
      return;
    }

    if (node.type !== 'variable_declarator') {
      return;
    }

    const name = this.extractDeclaredName(node) || this.extractAssignedName(parent);
    if (!name) {
      return;
    }

    const detail: PropertySymbolInfo = {
      name,
      kind: 'variable',
      language: state.language,
      parentFunction: state.functionStack[state.functionStack.length - 1]?.name,
      location: this.getLocation(node),
    };

    const key = `variable:${detail.parentFunction || 'global'}:${detail.name}:${detail.location.startLine}:${detail.location.endLine}`;
    if (state.detailKeys.has(key)) {
      return;
    }
    state.detailKeys.add(key);
    state.result.propertyDetails.push(detail);
    this.pushUnique(state.result.variables, detail.name);
  }

  private recordCall(node: any, state: WalkState): void {
    const callTypes = new Set([
      'call_expression',
      'call',
      'method_invocation',
      'invocation_expression',
    ]);

    if (!callTypes.has(node.type)) {
      return;
    }

    const callName = this.extractCallName(node);
    if (!callName) {
      return;
    }

    this.pushUnique(state.result.calls, callName);
    const currentFunction = state.functionStack[state.functionStack.length - 1];
    if (currentFunction) {
      this.pushUnique(currentFunction.calls, callName);
    }
  }

  private extractCallName(node: any): string | null {
    const direct =
      node.functionNode ||
      node.nameNode ||
      node.function ||
      null;

    if (!direct) {
      return null;
    }

    return this.extractReferenceName(direct);
  }

  private extractReferenceName(node: any): string | null {
    if (!node) {
      return null;
    }

    const simpleName = this.extractDeclaredName(node);
    if (simpleName) {
      return simpleName;
    }

    const memberCandidates = [
      node.propertyNode,
      node.fieldNode,
      node.attributeNode,
      node.nameNode,
    ].filter(Boolean);
    for (const candidate of memberCandidates) {
      const name = this.extractDeclaredName(candidate);
      if (name) {
        return name;
      }
    }

    if (typeof node.text === 'string' && node.text) {
      const lastSegment = node.text.split(/[.>:]+/).pop()?.replace(/\(\)$/, '').trim();
      return lastSegment || null;
    }

    return null;
  }

  private extractAssignedMemberName(leftNode: any): string | null {
    if (!leftNode) {
      return null;
    }

    const memberTypes = new Set([
      'member_expression',
      'field_access',
      'member_access_expression',
      'field_expression',
      'attribute',
    ]);

    if (!memberTypes.has(leftNode.type)) {
      return null;
    }

    const objectNode =
      leftNode.objectNode ||
      leftNode.expressionNode ||
      leftNode.argumentNode ||
      null;
    const objectName = objectNode?.text;

    if (objectName && !['this', 'self', 'cls'].includes(objectName)) {
      return null;
    }

    const propertyNode =
      leftNode.propertyNode ||
      leftNode.fieldNode ||
      leftNode.attributeNode ||
      leftNode.nameNode ||
      null;

    return propertyNode?.text || null;
  }

  private extractDeclaredNames(node: any): string[] {
    const names = new Set<string>();

    const direct = this.extractDeclaredName(node);
    if (direct) {
      names.add(direct);
    }

    for (const child of node.namedChildren || []) {
      if (['variable_declarator', 'formal_parameter', 'parameter', 'parameter_declaration'].includes(child.type)) {
        const childName = this.extractDeclaredName(child);
        if (childName) {
          names.add(childName);
        }
      }
    }

    return Array.from(names);
  }

  private extractDeclaredName(node: any): string | null {
    if (!node) {
      return null;
    }

    const directCandidates = [
      node.nameNode,
      node.propertyNode,
      node.fieldNode,
      node.attributeNode,
      node.declaratorNode,
      node.variableNode,
      node.aliasNode,
      node.leftNode,
    ].filter(Boolean);

    for (const candidate of directCandidates) {
      const nested = this.extractDeclaredName(candidate);
      if (nested) {
        return nested;
      }
    }

    const leafTypes = new Set([
      'identifier',
      'property_identifier',
      'field_identifier',
      'type_identifier',
    ]);
    if (leafTypes.has(node.type) && typeof node.text === 'string' && node.text.trim()) {
      return node.text.trim();
    }

    for (const child of node.namedChildren || []) {
      if (leafTypes.has(child.type)) {
        return child.text.trim();
      }
    }

    return null;
  }

  private extractAssignedName(parent: any): string | null {
    if (!parent) {
      return null;
    }

    if (parent.type === 'variable_declarator') {
      return this.extractDeclaredName(parent);
    }

    if (parent.type === 'assignment' || parent.type === 'assignment_expression') {
      const left = parent.leftNode;
      if (left?.type === 'identifier') {
        return left.text;
      }
    }

    return null;
  }

  private extractParameters(node: any): string[] {
    const container =
      node.parametersNode ||
      node.parameterNode ||
      node.declaratorNode?.parametersNode ||
      null;
    if (!container) {
      return [];
    }

    const names = new Set<string>();
    for (const child of container.namedChildren || []) {
      const name = this.extractDeclaredName(child);
      if (name) {
        names.add(name);
      }
    }

    return Array.from(names);
  }

  private extractImportSpecifiers(text: string): string[] {
    const specs = new Set<string>();
    const fromMatches = text.matchAll(/from\s+['"]([^'"]+)['"]/g);
    for (const match of fromMatches) {
      specs.add(match[1]);
    }

    const directImportMatches = text.matchAll(/import\s+['"]([^'"]+)['"]/g);
    for (const match of directImportMatches) {
      specs.add(match[1]);
    }

    const includeMatches = text.matchAll(/#include\s*[<"]([^>"]+)[>"]/g);
    for (const match of includeMatches) {
      specs.add(match[1]);
    }

    const usingMatches = text.matchAll(/using\s+([A-Za-z_][A-Za-z0-9_.]*)\s*;/g);
    for (const match of usingMatches) {
      specs.add(match[1]);
    }

    const javaImportMatches = text.matchAll(/^\s*import\s+(?:static\s+)?([A-Za-z_][A-Za-z0-9_.*]*)\s*;/gm);
    for (const match of javaImportMatches) {
      specs.add(match[1]);
    }

    const lines = text.split('\n');
    for (const line of lines) {
      const fromMatch = line.match(/^\s*from\s+([A-Za-z_][A-Za-z0-9_.]*)\s+import\b/);
      if (fromMatch) {
        specs.add(fromMatch[1]);
      }

      const importMatch = line.match(/^\s*import\s+([A-Za-z_][A-Za-z0-9_.,\s]*)$/);
      if (importMatch) {
        for (const part of importMatch[1].split(',')) {
          const moduleName = part.trim().split(/\s+as\s+/)[0];
          if (moduleName) {
            specs.add(moduleName);
          }
        }
      }
    }

    return Array.from(specs);
  }

  private getLocation(node: any): SymbolLocation {
    return {
      startLine: (node.startPosition?.row ?? node.startPoint?.row ?? 0) + 1,
      startColumn: (node.startPosition?.column ?? node.startPoint?.column ?? 0) + 1,
      endLine: (node.endPosition?.row ?? node.endPoint?.row ?? 0) + 1,
      endColumn: (node.endPosition?.column ?? node.endPoint?.column ?? 0) + 1,
    };
  }

  private pushUnique(items: string[], value?: string | null): void {
    const normalized = (value || '').trim();
    if (!normalized || items.includes(normalized)) {
      return;
    }
    items.push(normalized);
  }

  private createEmptyResult(language: SupportedLanguage): ExtractedSymbols {
    return {
      language,
      classes: [],
      functions: [],
      methods: [],
      properties: [],
      imports: [],
      variables: [],
      calls: [],
      classDetails: [],
      functionDetails: [],
      propertyDetails: [],
    };
  }

  /**
   * 正则回退路径。符号精度低于 tree-sitter，但语言标签仍然可知：
   * 优先用文件后缀判定，其次用内容启发式。保留语言标签很重要——
   * 项目级汇总（buildProjectSummary）按语言计数，若回退时一律记为 unknown，
   * 会让整份报告看起来"识别不出任何语言"，掩盖了真实原因是解析器降级。
   */
  private extractWithRegexFallback(code: string, filePath?: string): ExtractedSymbols {
    const fromPath = this.detectLanguageFromPath(filePath);
    const language = fromPath !== 'unknown' ? fromPath : this.detectLanguageFromContent(code);
    const result = this.createEmptyResult(language);
    const classes = Array.from(code.matchAll(/\bclass\s+([A-Za-z_][A-Za-z0-9_]*)/g)).map((match) => match[1]);
    const functions = Array.from(code.matchAll(/\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)/g)).map((match) => match[1]);
    const methods = Array.from(code.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\([^()]*\)\s*\{/g)).map((match) => match[1]);
    const properties = Array.from(code.matchAll(/\b(?:this|self)\.([A-Za-z_][A-Za-z0-9_]*)/g)).map((match) => match[1]);
    const variables = Array.from(code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)/g)).map((match) => match[1]);

    for (const name of classes) this.pushUnique(result.classes, name);
    for (const name of functions) this.pushUnique(result.functions, name);
    for (const name of methods) this.pushUnique(result.methods, name);
    for (const name of properties) this.pushUnique(result.properties, name);
    for (const name of variables) this.pushUnique(result.variables, name);
    for (const specifier of this.extractImportSpecifiers(code)) this.pushUnique(result.imports, specifier);

    return result;
  }

  collectProjectFiles(projectPath: string, includeExtensions: string[], excludeDirs: string[]): string[] {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const normalizedExts = new Set(includeExtensions.map((ext) => ext.toLowerCase()));
    const excluded = new Set(excludeDirs);
    const files: string[] = [];

    const walk = (currentPath: string) => {
      let stat: ReturnType<typeof fs.statSync>;
      try {
        stat = fs.statSync(currentPath);
      } catch {
        // 跳过无效的符号链接或不存在的文件
        return;
      }
      if (stat.isDirectory()) {
        const dirName = path.basename(currentPath);
        if (excluded.has(dirName)) {
          return;
        }
        for (const entry of fs.readdirSync(currentPath)) {
          walk(path.join(currentPath, entry));
        }
        return;
      }

      const ext = path.extname(currentPath).toLowerCase();
      if (normalizedExts.has(ext)) {
        files.push(currentPath);
      }
    };

    walk(projectPath);
    return files.sort((a, b) => a.localeCompare(b));
  }

  private buildLocalModuleIndex(files: ProjectFileAnalysis[]): Map<string, Set<string>> {
    const path = require('path') as typeof import('path');
    const index = new Map<string, Set<string>>();

    for (const file of files) {
      const rel = file.relativePath;
      const ext = path.extname(rel);
      const withoutExt = rel.slice(0, rel.length - ext.length);
      const base = path.basename(withoutExt);
      const withoutIndex = withoutExt.replace(/\/index$/i, '');
      const candidates = new Set<string>([
        rel,
        withoutExt,
        withoutIndex,
        base,
      ]);

      for (const dotted of this.buildDottedModuleCandidates(withoutExt)) candidates.add(dotted);
      for (const dotted of this.buildDottedModuleCandidates(withoutIndex)) candidates.add(dotted);
      for (const className of file.symbols.classes) candidates.add(className);
      for (const fn of file.symbols.functions) candidates.add(fn);

      for (const candidate of candidates) {
        const normalized = candidate.replace(/\\/g, '/');
        if (!normalized) continue;
        if (!index.has(normalized)) {
          index.set(normalized, new Set());
        }
        index.get(normalized)!.add(rel);
      }
    }

    return index;
  }

  private buildSymbolOwnerIndex(files: ProjectFileAnalysis[]): Map<string, string[]> {
    const owners = new Map<string, Set<string>>();

    for (const file of files) {
      const declaredSymbols = new Set<string>([
        ...file.symbols.classes,
        ...file.symbols.functions,
      ]);

      for (const symbol of declaredSymbols) {
        if (symbol.length < 3) {
          continue;
        }
        if (!owners.has(symbol)) {
          owners.set(symbol, new Set());
        }
        owners.get(symbol)!.add(file.relativePath);
      }
    }

    const finalized = new Map<string, string[]>();
    for (const [symbol, fileSet] of owners.entries()) {
      finalized.set(symbol, Array.from(fileSet).sort((a, b) => a.localeCompare(b)));
    }
    return finalized;
  }

  private resolveImportTargets(
    specifier: string,
    currentFile: ProjectFileAnalysis,
    projectRoot: string,
    byRelativePath: Map<string, ProjectFileAnalysis>,
    localModuleIndex: Map<string, Set<string>>
  ): string[] {
    const path = require('path') as typeof import('path');
    const targets = new Set<string>();

    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      const fromDir = path.dirname(currentFile.filePath);
      const resolvedBase = specifier.startsWith('/')
        ? path.resolve(projectRoot, `.${specifier}`)
        : path.resolve(fromDir, specifier);

      for (const candidate of this.expandCandidatePaths(resolvedBase)) {
        const rel = this.normalizeRelativePath(path.relative(projectRoot, candidate));
        if (byRelativePath.has(rel)) {
          targets.add(rel);
        }
      }
    }

    for (const key of this.buildImportLookupCandidates(specifier)) {
      if (!key) continue;
      const matches = localModuleIndex.get(key);
      if (!matches) continue;
      for (const match of matches) {
        if (match !== currentFile.relativePath) {
          targets.add(match);
        }
      }
    }

    return Array.from(targets).sort((a, b) => a.localeCompare(b));
  }

  private expandCandidatePaths(basePath: string): string[] {
    const candidates = new Set<string>();
    const exts = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.cpp', '.cc', '.cxx', '.hpp', '.h', '.cs'];

    candidates.add(basePath);
    for (const ext of exts) {
      candidates.add(`${basePath}${ext}`);
    }
    for (const ext of exts) {
      candidates.add(require('path').join(basePath, `index${ext}`));
    }

    return Array.from(candidates);
  }

  private buildDottedModuleCandidates(modulePath: string): string[] {
    const normalized = modulePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!normalized) {
      return [];
    }

    const segments = normalized.split('/').filter(Boolean);
    const candidates = new Set<string>();
    for (let index = 0; index < segments.length; index += 1) {
      candidates.add(segments.slice(index).join('.'));
    }
    return Array.from(candidates);
  }

  private buildImportLookupCandidates(specifier: string): string[] {
    const path = require('path') as typeof import('path');
    const normalizedSpecifier = specifier
      .trim()
      .replace(/\\/g, '/')
      .replace(/^@\//, '')
      .replace(/^src\//, '')
      .replace(/^\.\//, '')
      .replace(/\.\*$/g, '')
      .replace(/\.(ts|tsx|js|jsx|py|java|cpp|cc|cxx|hpp|h|cs)$/i, '');

    const candidates = new Set<string>([
      specifier,
      normalizedSpecifier,
      path.basename(normalizedSpecifier),
    ]);

    if (normalizedSpecifier.includes('/')) {
      const slashSegments = normalizedSpecifier.split('/').filter(Boolean);
      for (let index = 0; index < slashSegments.length; index += 1) {
        candidates.add(slashSegments.slice(index).join('/'));
        candidates.add(slashSegments.slice(index).join('.'));
      }
    }

    if (normalizedSpecifier.includes('.')) {
      const dotSegments = normalizedSpecifier.split('.').filter(Boolean);
      for (let index = 0; index < dotSegments.length; index += 1) {
        candidates.add(dotSegments.slice(index).join('.'));
      }
      for (let index = dotSegments.length - 1; index > 0; index -= 1) {
        candidates.add(dotSegments.slice(0, index).join('.'));
      }
      candidates.add(dotSegments.join('/'));
      candidates.add(dotSegments[dotSegments.length - 1]);
      if (dotSegments.length > 1) {
        candidates.add(dotSegments[dotSegments.length - 2]);
      }
    }

    return Array.from(candidates).filter(Boolean);
  }

  private normalizeRelativePath(relPath: string): string {
    return relPath.replace(/\\/g, '/');
  }

  private isIncludeSpecifier(specifier: string): boolean {
    return !specifier.startsWith('.') && !specifier.includes('/') && !specifier.includes('.');
  }

  private buildProjectSummary(files: ProjectFileAnalysis[]): ProjectAnalysisSummary {
    const languages: Record<string, number> = {};
    let totalClasses = 0;
    let totalFunctions = 0;
    let totalMethods = 0;
    let totalProperties = 0;
    let totalCalls = 0;

    for (const file of files) {
      languages[file.language] = (languages[file.language] || 0) + 1;
      totalClasses += file.symbols.classes.length;
      totalFunctions += file.symbols.functions.length;
      totalMethods += file.symbols.methods.length;
      totalProperties += file.symbols.properties.length;
      totalCalls += file.symbols.calls.length;
    }

    return {
      totalFiles: files.length,
      languages,
      totalClasses,
      totalFunctions,
      totalMethods,
      totalProperties,
      totalCalls,
    };
  }

  private loadExternalRelatedFiles(
    relatedFilesDataPath: string | undefined,
    projectRoot: string,
    byRelativePath: Map<string, ProjectFileAnalysis>,
    localModuleIndex: Map<string, Set<string>>
  ): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>();
    if (!relatedFilesDataPath) {
      return map;
    }

    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const baseDir = path.resolve(relatedFilesDataPath);
    if (!fs.existsSync(baseDir)) {
      return map;
    }

    const jsonFiles: string[] = [];
    const walk = (currentPath: string) => {
      const stat = fs.statSync(currentPath);
      if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(currentPath)) {
          walk(path.join(currentPath, entry));
        }
        return;
      }
      if (currentPath.endsWith('.json')) {
        jsonFiles.push(currentPath);
      }
    };
    walk(baseDir);

    for (const jsonFile of jsonFiles) {
      let parsed: any;
      try {
        parsed = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
      } catch {
        continue;
      }
      if (!parsed || !Array.isArray(parsed.relatedFiles)) {
        continue;
      }

      const sourceCandidates = this.resolveExternalSourceFile(
        path.relative(baseDir, jsonFile),
        projectRoot,
        byRelativePath,
        localModuleIndex
      );
      if (sourceCandidates.length === 0) {
        continue;
      }

      const targetPaths = new Set<string>();
      for (const item of parsed.relatedFiles) {
        const candidateStrings = new Set<string>();
        if (typeof item?.file_path === 'string') candidateStrings.add(item.file_path);
        for (const outgoing of item?.outgoing || []) {
          if (typeof outgoing?.target_file === 'string') candidateStrings.add(outgoing.target_file);
        }
        for (const incoming of item?.incoming || []) {
          if (typeof incoming?.source_file === 'string') candidateStrings.add(incoming.source_file);
        }

        for (const candidate of candidateStrings) {
          for (const resolved of this.resolveExternalPathCandidate(candidate, projectRoot, byRelativePath, localModuleIndex)) {
            targetPaths.add(resolved);
          }
        }
      }

      for (const source of sourceCandidates) {
        if (!map.has(source)) {
          map.set(source, new Set());
        }
        const bucket = map.get(source)!;
        for (const target of targetPaths) {
          if (target !== source) {
            bucket.add(target);
          }
        }
      }
    }

    return map;
  }

  private resolveExternalSourceFile(
    jsonRelativePath: string,
    projectRoot: string,
    byRelativePath: Map<string, ProjectFileAnalysis>,
    localModuleIndex: Map<string, Set<string>>
  ): string[] {
    const normalized = this.normalizeRelativePath(jsonRelativePath).replace(/\.json$/i, '');
    return this.resolveExternalPathCandidate(normalized, projectRoot, byRelativePath, localModuleIndex);
  }

  private resolveExternalPathCandidate(
    candidate: string,
    projectRoot: string,
    byRelativePath: Map<string, ProjectFileAnalysis>,
    localModuleIndex: Map<string, Set<string>>
  ): string[] {
    const path = require('path') as typeof import('path');
    const normalized = this.normalizeRelativePath(candidate);
    const result = new Set<string>();

    const directCandidates = [
      normalized,
      normalized.replace(/^\.\//, ''),
      normalized.replace(/\.(md|diff|json)$/i, ''),
    ];

    for (const direct of directCandidates) {
      if (byRelativePath.has(direct)) {
        result.add(direct);
      }
      const withoutExt = direct.replace(/\.(ts|tsx|js|jsx|py|java|cpp|cc|cxx|hpp|h|cs)$/i, '');
      const matches = localModuleIndex.get(withoutExt) || localModuleIndex.get(path.basename(withoutExt));
      if (matches) {
        for (const match of matches) {
          result.add(match);
        }
      }
      const absolute = path.resolve(projectRoot, direct);
      const relative = this.normalizeRelativePath(path.relative(projectRoot, absolute));
      if (byRelativePath.has(relative)) {
        result.add(relative);
      }
    }

    return Array.from(result);
  }
}
