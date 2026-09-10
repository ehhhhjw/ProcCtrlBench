import type { ExtractedSymbols, SupportedLanguage } from '../analyzers/AstAnalyzer';

export interface ProjectAnalysisOutputFiles {
  fileGraph: string;
  projectAst: string;
}

export interface ProjectAnalysisConfig {
  projectPath: string;
  outputDir: string;
  includeExtensions: string[];
  excludeDirs: string[];
  enableSymbolRelations: boolean;
  relatedFilesDataPath?: string;
  outputFiles: ProjectAnalysisOutputFiles;
}

export interface FileRelation {
  target: string;
  type: 'import' | 'symbol_reference' | 'include' | 'external_related';
  evidence: string[];
}

export interface ProjectFileAnalysis {
  filePath: string;
  relativePath: string;
  language: SupportedLanguage;
  symbols: ExtractedSymbols;
  importedModules: string[];
  resolvedImports: string[];
  relations: FileRelation[];
}

export interface ProjectAnalysisSummary {
  totalFiles: number;
  languages: Record<string, number>;
  totalClasses: number;
  totalFunctions: number;
  totalMethods: number;
  totalProperties: number;
  totalCalls: number;
}

export interface ProjectAnalysisResult {
  projectPath: string;
  generatedAt: string;
  config: ProjectAnalysisConfig;
  summary: ProjectAnalysisSummary;
  fileGraph: Record<string, string[]>;
  files: ProjectFileAnalysis[];
}
