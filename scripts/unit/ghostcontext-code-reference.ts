import * as fs from 'fs';
import * as path from 'path';
import { GhostContextDetector } from '../../src/detectors/GhostContextDetector';
import { DEFAULT_EVALUATION_CONFIG } from '../../src/config/evaluation.config';
import { SessionData, MessageNode, ToolUseInfo, ToolResultInfo, AgentInfo, BranchTree, SessionStatistics, ContentReplacementRecord } from '../../ClaudeCodeStructure/src/types';

function createProjectAstFixture() {
  return {
    projectPath: process.cwd(),
    generatedAt: new Date().toISOString(),
    config: {
      projectPath: process.cwd(),
      outputDir: 'output',
      includeExtensions: ['.ts'],
      excludeDirs: [],
      enableSymbolRelations: false,
      relatedFilesDataPath: '',
      outputFiles: {
        fileGraph: 'file-graph.json',
        projectAst: 'project-ast.json',
      },
    },
    summary: {
      totalFiles: 2,
      languages: { typescript: 2 },
      totalClasses: 0,
      totalFunctions: 2,
      totalMethods: 0,
      totalProperties: 0,
      totalCalls: 0,
    },
    fileGraph: {
      'src/core/a.ts': ['src/core/b.ts'],
      'src/core/b.ts': ['src/core/a.ts'],
    },
    files: [
      createProjectFile('src/core/a.ts', ['alpha'], [{ target: 'src/core/b.ts', type: 'import', evidence: ['./b'] }]),
      createProjectFile('src/core/b.ts', ['beta'], [{ target: 'src/core/a.ts', type: 'import', evidence: ['./a'] }]),
    ],
  };
}

function createProjectFile(relativePath: string, functions: string[], relations: any[]) {
  return {
    filePath: path.join(process.cwd(), relativePath),
    relativePath,
    language: 'typescript',
    symbols: {
      language: 'typescript',
      classes: [],
      functions,
      methods: [],
      properties: [],
      imports: [],
      variables: [],
      calls: [],
      classDetails: [],
      functionDetails: [],
      propertyDetails: [],
    },
    importedModules: [],
    resolvedImports: relations.map((relation: any) => relation.target),
    relations,
  };
}

function createSession(): SessionData {
  const stats: SessionStatistics = {
    totalMessages: 2,
    messagesByType: { user: 0, assistant: 2, attachment: 0, system: 0 },
    totalToolUses: 2,
    toolUsesByName: { Read: 2 },
    totalAgents: 0,
    totalBranches: 0,
    totalReplacements: 1,
    totalTokens: { input: 0, output: 0 },
    timeRange: { start: 1, end: 4, duration: 0 },
  };

  const session: SessionData = {
    messages: new Map<string, MessageNode>(),
    messagesByMessageId: new Map(),
    agents: new Map<string, AgentInfo>(),
    branchTree: ({}) as BranchTree,
    toolUses: new Map<string, ToolUseInfo>(),
    toolResults: new Map<string, ToolResultInfo>(),
    replacements: new Map<string, ContentReplacementRecord>(),
    title: 'unit',
    tags: [],
    prLinks: [],
    timeline: [],
    statistics: stats,
  } as any;

  const largeContent = `src/core/a.ts\n${'function alpha() { return 1; }\n'.repeat(120)}`;

  const message0: MessageNode = {
    uuid: 'm0',
    messageId: 'm0',
    type: 'assistant',
    timestamp: 1,
    content: '',
    children: [],
    toolUses: [],
    toolResults: [],
    replacements: [],
  } as any;
  const tool0: ToolUseInfo = {
    id: 'tu0',
    name: 'Read',
    input: { file_path: 'src/core/a.ts' },
    timestamp: 1,
    messageId: 'm0',
    messageUuid: 'm0',
    hasResult: true,
  } as any;
  const result0: ToolResultInfo = {
    tool_use_id: 'tu0',
    content: largeContent,
    is_error: false,
    timestamp: 2,
    messageId: 'm0',
    messageUuid: 'm0',
  } as any;
  message0.toolUses.push(tool0);
  message0.toolResults.push(result0);

  const message1: MessageNode = {
    uuid: 'm1',
    messageId: 'm1',
    type: 'assistant',
    timestamp: 3,
    content: '',
    children: [],
    toolUses: [],
    toolResults: [],
    replacements: [],
  } as any;
  const tool1: ToolUseInfo = {
    id: 'tu1',
    name: 'Read',
    input: { file_path: 'src/core/b.ts' },
    timestamp: 3,
    messageId: 'm1',
    messageUuid: 'm1',
    hasResult: true,
  } as any;
  const result1: ToolResultInfo = {
    tool_use_id: 'tu1',
    content: 'function beta() { return alpha(); }',
    is_error: false,
    timestamp: 4,
    messageId: 'm1',
    messageUuid: 'm1',
  } as any;
  message1.toolUses.push(tool1);
  message1.toolResults.push(result1);

  session.messages.set('m0', message0);
  session.messages.set('m1', message1);
  session.messagesByMessageId.set('m0', ['m0']);
  session.messagesByMessageId.set('m1', ['m1']);
  session.toolUses.set('tu0', tool0);
  session.toolUses.set('tu1', tool1);
  session.toolResults.set('tu0', result0);
  session.toolResults.set('tu1', result1);
  session.replacements.set('r0', {
    uuid: 'r0',
    messageId: 'm0',
    originalContent: largeContent,
    replacementContent: 'summary of a.ts',
    timestamp: 5,
  } as any);

  return session;
}

function backupFile(filePath: string): string | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  const backupPath = `${filePath}.bak-unit`;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function restoreFile(filePath: string, backupPath?: string): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  if (backupPath && fs.existsSync(backupPath)) {
    fs.renameSync(backupPath, filePath);
  }
}

async function main() {
  const outputDir = path.join(process.cwd(), 'output');
  const projectAstPath = path.join(outputDir, 'project-ast.json');
  fs.mkdirSync(outputDir, { recursive: true });
  const backupPath = backupFile(projectAstPath);

  try {
    fs.writeFileSync(projectAstPath, JSON.stringify(createProjectAstFixture(), null, 2), 'utf-8');
    const issues = await new GhostContextDetector(createSession(), DEFAULT_EVALUATION_CONFIG).detect();
    const ghostIssue = issues.find((issue) => issue.metric === 'ghostContext' && issue.location?.messageUuid === 'm0');
    if (ghostIssue) {
      console.error('相关文件已继续被使用时，不应误判为 ghostContext:', JSON.stringify(ghostIssue, null, 2));
      process.exit(1);
    }
    console.log('[ok] ghostcontext-code-reference: 相关文件继续被使用时不误判 ghostContext');
  } finally {
    restoreFile(projectAstPath, backupPath);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
