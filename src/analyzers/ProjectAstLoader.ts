import * as fs from 'fs';
import * as path from 'path';
import {
  ProjectAnalysisResult,
  ProjectFileAnalysis,
  FileRelation,
} from '../types/project-analysis.types';

export class ProjectAstLoader {
  private data?: ProjectAnalysisResult;
  private filesByRelativePath = new Map<string, ProjectFileAnalysis>();
  private ownersBySymbol = new Map<string, Set<string>>();
  private usersBySymbol = new Map<string, Set<string>>();
  private reverseRelations = new Map<string, FileRelation[]>();

  constructor(private jsonPath: string) {}

  load(): void {
    if (!fs.existsSync(this.jsonPath)) {
      throw new Error(`Project AST not found: ${this.jsonPath}`);
    }

    this.data = JSON.parse(fs.readFileSync(this.jsonPath, 'utf-8')) as ProjectAnalysisResult;
    this.filesByRelativePath.clear();
    this.ownersBySymbol.clear();
    this.usersBySymbol.clear();
    this.reverseRelations.clear();

    for (const file of this.data.files) {
      const relativePath = this.normalizeRelativePath(file.relativePath);
      this.filesByRelativePath.set(relativePath, file);

      for (const symbol of this.getDeclaredSymbolsForFile(file)) {
        if (!this.ownersBySymbol.has(symbol)) {
          this.ownersBySymbol.set(symbol, new Set());
        }
        this.ownersBySymbol.get(symbol)!.add(relativePath);
      }

      for (const symbol of file.symbols.calls) {
        if (!this.usersBySymbol.has(symbol)) {
          this.usersBySymbol.set(symbol, new Set());
        }
        this.usersBySymbol.get(symbol)!.add(relativePath);
      }

      for (const relation of file.relations) {
        const target = this.normalizeRelativePath(relation.target);
        if (!this.reverseRelations.has(target)) {
          this.reverseRelations.set(target, []);
        }
        this.reverseRelations.get(target)!.push({
          target: relativePath,
          type: relation.type,
          evidence: [...relation.evidence],
        });
      }
    }
  }

  getProjectRoot(): string | undefined {
    return this.data?.projectPath;
  }

  getFile(filePath: string): ProjectFileAnalysis | undefined {
    const normalized = this.normalizeInputPath(filePath);
    if (!normalized) {
      return undefined;
    }
    return this.filesByRelativePath.get(normalized);
  }

  getRelations(
    filePath: string,
    includeReverse = false,
    relationTypes?: FileRelation['type'][]
  ): FileRelation[] {
    const file = this.getFile(filePath);
    if (!file) {
      return [];
    }

    const allowedTypes = relationTypes ? new Set(relationTypes) : undefined;
    const relations = file.relations.filter((relation) => !allowedTypes || allowedTypes.has(relation.type));
    if (!includeReverse) {
      return relations;
    }

    const reverse = (this.reverseRelations.get(file.relativePath) || [])
      .filter((relation) => !allowedTypes || allowedTypes.has(relation.type))
      .map((relation) => ({
        target: this.normalizeRelativePath(relation.target),
        type: relation.type,
        evidence: [...relation.evidence, 'reverse_relation'],
      }));
    return [...relations, ...reverse];
  }

  getRelatedFiles(
    filePath: string,
    includeReverse = true,
    relationTypes?: FileRelation['type'][]
  ): string[] {
    const file = this.getFile(filePath);
    if (!file) {
      return [];
    }

    const related = new Set<string>();
    const allowedTypes = relationTypes ? new Set(relationTypes) : undefined;

    for (const relation of file.relations) {
      if (allowedTypes && !allowedTypes.has(relation.type)) {
        continue;
      }
      related.add(this.normalizeRelativePath(relation.target));
    }
    if (includeReverse) {
      for (const relation of this.reverseRelations.get(file.relativePath) || []) {
        if (allowedTypes && !allowedTypes.has(relation.type)) {
          continue;
        }
        related.add(this.normalizeRelativePath(relation.target));
      }
    }
    related.delete(file.relativePath);
    return Array.from(related);
  }

  getRelatedNeighborhood(
    filePaths: Iterable<string>,
    depth = 1,
    includeReverse = true,
    relationTypes?: FileRelation['type'][]
  ): string[] {
    const visited = new Set<string>();
    const frontier: string[] = [];

    for (const filePath of filePaths) {
      const normalized = this.normalizeInputPath(filePath);
      if (!normalized || visited.has(normalized)) {
        continue;
      }
      visited.add(normalized);
      frontier.push(normalized);
    }

    let currentDepth = 0;
    let level = frontier;
    while (level.length > 0 && currentDepth < depth) {
      const nextLevel: string[] = [];
      for (const file of level) {
        for (const related of this.getRelatedFiles(file, includeReverse, relationTypes)) {
          if (visited.has(related)) {
            continue;
          }
          visited.add(related);
          nextLevel.push(related);
        }
      }
      level = nextLevel;
      currentDepth += 1;
    }

    return Array.from(visited);
  }

  areFilesRelated(a: string, b: string): boolean {
    const normalizedA = this.normalizeInputPath(a);
    const normalizedB = this.normalizeInputPath(b);
    if (!normalizedA || !normalizedB) {
      return false;
    }
    if (normalizedA === normalizedB) {
      return true;
    }
    return this.getRelatedFiles(normalizedA, true).includes(normalizedB);
  }

  getRelationTypesBetween(
    sourcePath: string,
    targetPath: string,
    includeReverse = true
  ): FileRelation['type'][] {
    const normalizedSource = this.normalizeInputPath(sourcePath);
    const normalizedTarget = this.normalizeInputPath(targetPath);
    if (!normalizedSource || !normalizedTarget) {
      return [];
    }

    const types = new Set<FileRelation['type']>();
    for (const relation of this.getRelations(normalizedSource, includeReverse)) {
      if (this.normalizeRelativePath(relation.target) === normalizedTarget) {
        types.add(relation.type);
      }
    }
    return Array.from(types);
  }

  getOwnersForSymbol(symbol: string): string[] {
    return Array.from(this.ownersBySymbol.get(symbol) || []);
  }

  getUsersForSymbol(symbol: string): string[] {
    return Array.from(this.usersBySymbol.get(symbol) || []);
  }

  getFilesOwningAnySymbol(symbols: Iterable<string>): string[] {
    const owners = new Set<string>();
    for (const symbol of symbols) {
      for (const file of this.getOwnersForSymbol(symbol)) {
        owners.add(file);
      }
    }
    return Array.from(owners);
  }

  fileDefinesAnySymbol(filePath: string, symbols: Iterable<string>): boolean {
    const file = this.getFile(filePath);
    if (!file) {
      return false;
    }

    const declared = this.getDeclaredSymbolsForFile(file);
    for (const symbol of symbols) {
      if (declared.has(symbol)) {
        return true;
      }
    }
    return false;
  }

  fileUsesAnySymbol(filePath: string, symbols: Iterable<string>): boolean {
    const file = this.getFile(filePath);
    if (!file) {
      return false;
    }

    const used = new Set<string>([
      ...file.symbols.calls,
      ...file.symbols.imports,
      ...file.symbols.functions,
      ...file.symbols.methods,
      ...file.symbols.properties,
    ]);

    for (const symbol of symbols) {
      if (used.has(symbol)) {
        return true;
      }
    }
    return false;
  }

  getDeclaredSymbols(filePath: string): string[] {
    const file = this.getFile(filePath);
    if (!file) {
      return [];
    }
    return Array.from(this.getDeclaredSymbolsForFile(file));
  }

  private getDeclaredSymbolsForFile(file: ProjectFileAnalysis): Set<string> {
    return new Set<string>([
      ...file.symbols.classes,
      ...file.symbols.functions,
      ...file.symbols.methods,
      ...file.symbols.properties,
      ...file.symbols.variables,
    ]);
  }

  private normalizeInputPath(filePath: string): string | undefined {
    if (!filePath) {
      return undefined;
    }

    const normalized = this.normalizeRelativePath(filePath);
    if (this.filesByRelativePath.has(normalized)) {
      return normalized;
    }

    const projectRoot = this.getProjectRoot();
    if (projectRoot) {
      const absolute = path.isAbsolute(filePath)
        ? path.normalize(filePath)
        : path.resolve(projectRoot, filePath);
      const relative = this.normalizeRelativePath(path.relative(projectRoot, absolute));
      if (this.filesByRelativePath.has(relative)) {
        return relative;
      }
    }

    for (const candidate of this.filesByRelativePath.keys()) {
      if (candidate.endsWith(normalized)) {
        return candidate;
      }
    }

    return undefined;
  }

  private normalizeRelativePath(filePath: string): string {
    return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  }
}
