import { MessageNode, SessionData, ToolUseInfo } from '../../ClaudeCodeStructure/src/types';
import { AstAnalyzer, ExtractedSymbols } from './AstAnalyzer';
import { ProjectAstLoader } from './ProjectAstLoader';

export interface CodeFootprint {
  directFiles: Set<string>;
  strongRelatedFiles: Set<string>;
  weakRelatedFiles: Set<string>;
  symbols: Set<string>;
}

const LIKELY_FILE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.java', '.kt', '.kts', '.cpp', '.cc', '.cxx', '.hpp', '.h', '.cs',
  '.go', '.rs', '.rb', '.php', '.swift', '.m', '.mm',
  '.json', '.yaml', '.yml', '.xml', '.gradle', '.properties',
  '.md', '.txt', '.sql', '.sh', '.bash',
  '.html', '.css', '.scss', '.less',
]);

export class CodeContextAnalyzer {
  constructor(
    private sessionData: SessionData,
    private ast?: AstAnalyzer,
    private projectAst?: ProjectAstLoader
  ) {}

  createEmptyFootprint(): CodeFootprint {
    return {
      directFiles: new Set<string>(),
      strongRelatedFiles: new Set<string>(),
      weakRelatedFiles: new Set<string>(),
      symbols: new Set<string>(),
    };
  }

  mergeFootprints(...footprints: CodeFootprint[]): CodeFootprint {
    const merged = this.createEmptyFootprint();

    for (const footprint of footprints) {
      for (const file of footprint.directFiles) merged.directFiles.add(file);
      for (const file of footprint.strongRelatedFiles) merged.strongRelatedFiles.add(file);
      for (const file of footprint.weakRelatedFiles) merged.weakRelatedFiles.add(file);
      for (const symbol of footprint.symbols) merged.symbols.add(symbol);
    }

    return merged;
  }

  getMessageFootprint(message: MessageNode): CodeFootprint {
    const footprints: CodeFootprint[] = [];

    const textContent = this.extractContent(message.content);
    if (textContent) {
      footprints.push(this.getTextFootprint(textContent));
    }

    for (const toolUse of message.toolUses || []) {
      footprints.push(this.getToolFootprint(toolUse));
    }

    return this.mergeFootprints(...footprints);
  }

  getToolFootprint(toolUse: ToolUseInfo): CodeFootprint {
    const base = this.createEmptyFootprint();

    for (const file of this.extractToolPaths(toolUse)) {
      this.addFile(base, file);
    }

    const result = this.sessionData.toolResults.get(toolUse.id);
    if (result) {
      const resultContent = this.extractContent(result.content);
      if (resultContent) {
        const resultFootprint = this.getTextFootprint(
          resultContent,
          toolUse.input?.file_path || toolUse.input?.path
        );
        return this.mergeFootprints(base, resultFootprint);
      }
    }

    return base;
  }

  getTextFootprint(text: string, filePathHint?: string): CodeFootprint {
    const footprint = this.createEmptyFootprint();

    for (const file of this.extractPathsFromText(text, filePathHint)) {
      this.addFile(footprint, file);
    }

    const extracted = this.extractSymbols(text, filePathHint);
    for (const symbol of [
      ...extracted.classes,
      ...extracted.functions,
      ...extracted.methods,
      ...(extracted.properties || []),
      ...(extracted.variables || []),
      ...(extracted.calls || []),
    ]) {
      if (symbol) {
        footprint.symbols.add(symbol);
      }
    }

    return footprint;
  }

  hasMeaningfulOverlap(a: CodeFootprint, b: CodeFootprint, threshold = 0.25): boolean {
    return this.calculateOverlapScore(a, b) >= threshold;
  }

  calculateOverlapScore(a: CodeFootprint, b: CodeFootprint): number {
    const directOverlap = this.setSimilarity(a.directFiles, b.directFiles);
    const strongOverlap = this.setSimilarity(
      this.combineSets(a.directFiles, a.strongRelatedFiles),
      this.combineSets(b.directFiles, b.strongRelatedFiles)
    );
    const weakOverlap = this.setSimilarity(
      this.combineSets(a.directFiles, a.strongRelatedFiles, a.weakRelatedFiles),
      this.combineSets(b.directFiles, b.strongRelatedFiles, b.weakRelatedFiles)
    );
    const symbolOverlap = this.setSimilarity(a.symbols, b.symbols);

    return Math.max(
      directOverlap,
      strongOverlap * 0.85,
      weakOverlap * 0.65,
      symbolOverlap * 0.9
    );
  }

  summarizeFootprint(footprint: CodeFootprint): Record<string, unknown> {
    return {
      directFiles: Array.from(footprint.directFiles),
      strongRelatedFiles: Array.from(footprint.strongRelatedFiles),
      weakRelatedFiles: Array.from(footprint.weakRelatedFiles),
      symbols: Array.from(footprint.symbols).slice(0, 20),
    };
  }

  extractContent(content: any): string {
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text || '')
        .join('\n');
    }

    return '';
  }

  extractToolPaths(toolUse: ToolUseInfo): string[] {
    const paths = new Set<string>();

    for (const key of ['file_path', 'path']) {
      const value = toolUse.input?.[key];
      if (typeof value === 'string' && value.trim()) {
        paths.add(value);
      }
    }

    if (toolUse.name === 'Bash') {
      for (const file of this.extractPathsFromText(String(toolUse.input?.command || ''))) {
        paths.add(file);
      }
    }

    return Array.from(paths);
  }

  extractPathsFromText(text: string, filePathHint?: string): string[] {
    const files = new Set<string>();
    const normalizedHint = this.normalizeFilePath(filePathHint);
    if (normalizedHint) {
      files.add(normalizedHint);
    }

    const regex = /(?:\.?\/)?[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g;
    for (const match of text.match(regex) || []) {
      const normalized = this.normalizeFilePath(match);
      if (normalized) {
        files.add(normalized);
      }
    }

    return Array.from(files);
  }

  private addFile(footprint: CodeFootprint, filePath: string): void {
    const normalized = this.normalizeFilePath(filePath);
    if (!normalized) {
      return;
    }

    footprint.directFiles.add(normalized);

    if (!this.projectAst) {
      return;
    }

    for (const related of this.projectAst.getRelatedFiles(normalized, true, ['import', 'include', 'symbol_reference'])) {
      footprint.strongRelatedFiles.add(related);
    }
    for (const related of this.projectAst.getRelatedFiles(normalized, true, ['external_related'])) {
      footprint.weakRelatedFiles.add(related);
    }
    for (const symbol of this.projectAst.getDeclaredSymbols(normalized)) {
      footprint.symbols.add(symbol);
    }
  }

  private normalizeFilePath(filePath?: string): string | undefined {
    if (!filePath || !filePath.trim()) {
      return undefined;
    }

    const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '').trim();
    if (!normalized) {
      return undefined;
    }

    const hasPathSeparator = normalized.includes('/');
    const ext = normalized.includes('.') ? `.${normalized.split('.').pop()}`.toLowerCase() : '';

    if (!hasPathSeparator && !LIKELY_FILE_EXTENSIONS.has(ext)) {
      return undefined;
    }

    return normalized;
  }

  private extractSymbols(text: string, filePathHint?: string): ExtractedSymbols {
    if (!this.ast || !text.trim()) {
      return {
        language: 'unknown',
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

    return this.ast.extractSymbols(text, { filePath: filePathHint });
  }

  private setSimilarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) {
      return 0;
    }

    const union = new Set<string>([...a, ...b]);
    let intersection = 0;
    for (const value of a) {
      if (b.has(value)) {
        intersection += 1;
      }
    }
    return union.size > 0 ? intersection / union.size : 0;
  }

  private combineSets(...sets: Set<string>[]): Set<string> {
    const combined = new Set<string>();
    for (const set of sets) {
      for (const value of set) {
        combined.add(value);
      }
    }
    return combined;
  }
}
