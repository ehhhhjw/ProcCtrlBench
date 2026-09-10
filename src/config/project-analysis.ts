import * as fs from 'fs';
import * as path from 'path';
import { ProjectAnalysisConfig } from '../types/project-analysis.types';

export const DEFAULT_PROJECT_ANALYSIS_CONFIG: ProjectAnalysisConfig = {
  projectPath: '.',
  outputDir: 'output',
  includeExtensions: ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.cpp', '.cc', '.cxx', '.hpp', '.h', '.cs'],
  excludeDirs: [
    'node_modules',
    'dist',
    'build',
    'output',
    '.git',
    '.idea',
    '.vscode',
    '.venv',
    'coverage',
  ],
  enableSymbolRelations: false,
  relatedFilesDataPath: '',
  outputFiles: {
    fileGraph: 'file-graph.json',
    projectAst: 'project-ast.json',
  },
};

export function loadProjectAnalysisConfig(configPath?: string): ProjectAnalysisConfig {
  const root = process.cwd();
  const resolvedConfigPath = configPath
    ? path.resolve(root, configPath)
    : path.resolve(root, 'config/project-analysis.config.json');

  if (!fs.existsSync(resolvedConfigPath)) {
    return {
      ...DEFAULT_PROJECT_ANALYSIS_CONFIG,
    };
  }

  const raw = JSON.parse(fs.readFileSync(resolvedConfigPath, 'utf-8')) as Partial<ProjectAnalysisConfig>;

  return {
    ...DEFAULT_PROJECT_ANALYSIS_CONFIG,
    ...raw,
    outputFiles: {
      ...DEFAULT_PROJECT_ANALYSIS_CONFIG.outputFiles,
      ...(raw.outputFiles || {}),
    },
    includeExtensions: raw.includeExtensions || DEFAULT_PROJECT_ANALYSIS_CONFIG.includeExtensions,
    excludeDirs: raw.excludeDirs || DEFAULT_PROJECT_ANALYSIS_CONFIG.excludeDirs,
  };
}
