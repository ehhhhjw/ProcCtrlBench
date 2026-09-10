import * as fs from 'fs';
import * as path from 'path';
import { WeakToolDetector } from '../../src/detectors/WeakToolDetector';
import { DEFAULT_EVALUATION_CONFIG } from '../../src/config/evaluation.config';
import { SessionData, MessageNode, ToolUseInfo, AgentInfo, BranchTree, SessionStatistics } from '../../ClaudeCodeStructure/src/types';

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
      totalFiles: 3,
      languages: { typescript: 3 },
      totalClasses: 0,
      totalFunctions: 3,
      totalMethods: 0,
      totalProperties: 0,
      totalCalls: 0,
    },
    fileGraph: {
      'src/core/a.ts': ['src/core/b.ts'],
      'src/core/b.ts': ['src/core/a.ts', 'src/core/c.ts'],
      'src/core/c.ts': ['src/core/b.ts'],
    },
    files: [
      createProjectFile('src/core/a.ts', ['alpha'], [{ target: 'src/core/b.ts', type: 'import', evidence: ['./b'] }]),
      createProjectFile('src/core/b.ts', ['beta'], [{ target: 'src/core/a.ts', type: 'import', evidence: ['./a'] }, { target: 'src/core/c.ts', type: 'import', evidence: ['./c'] }]),
      createProjectFile('src/core/c.ts', ['gamma'], [{ target: 'src/core/b.ts', type: 'import', evidence: ['./b'] }]),
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
  const totalMessages = 4;
  const stats: SessionStatistics = {
    totalMessages,
    messagesByType: { user: 0, assistant: totalMessages, attachment: 0, system: 0 },
    totalToolUses: totalMessages,
    toolUsesByName: { Edit: totalMessages },
    totalAgents: 0,
    totalBranches: 0,
    totalReplacements: 0,
    totalTokens: { input: 0, output: 0 },
    timeRange: { start: 1, end: totalMessages, duration: 0 },
  };

  const session: SessionData = {
    messages: new Map<string, MessageNode>(),
    messagesByMessageId: new Map(),
    agents: new Map<string, AgentInfo>(),
    branchTree: ({}) as BranchTree,
    toolUses: new Map<string, ToolUseInfo>(),
    toolResults: new Map(),
    replacements: new Map(),
    title: 'unit',
    tags: [],
    prLinks: [],
    timeline: [],
    statistics: stats,
  } as any;

  const files = ['src/core/a.ts', 'src/core/b.ts', 'src/core/c.ts', 'src/core/b.ts'];
  files.forEach((file, index) => {
    const message: MessageNode = {
      uuid: `m${index}`,
      messageId: `m${index}`,
      type: 'assistant',
      timestamp: index + 1,
      content: '',
      children: [],
      toolUses: [],
      toolResults: [],
      replacements: [],
    } as any;
    const toolUse: ToolUseInfo = {
      id: `tu${index}`,
      name: 'Edit',
      input: { file_path: file, old_string: 'x', new_string: 'y' },
      timestamp: index + 1,
      messageId: `m${index}`,
      messageUuid: `m${index}`,
      hasResult: false,
    } as any;
    message.toolUses.push(toolUse);
    session.messages.set(message.uuid, message);
    session.toolUses.set(toolUse.id, toolUse);
    session.messagesByMessageId.set(message.messageId, [message.uuid]);
  });

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
    const issues = await new WeakToolDetector(createSession(), DEFAULT_EVALUATION_CONFIG).detect();
    const issue = issues.find((item) => item.metric === 'weakTool' && item.evidence?.details?.toolName === 'Agent');
    if (!issue) {
      console.error('In a multi-file related-change scenario the Agent weak-tool opportunity should be identified, but it was not');
      process.exit(1);
    }
    console.log('[ok] weaktool-ast-opportunity: multi-file related changes reveal the Agent weak-tool opportunity');
  } finally {
    restoreFile(projectAstPath, backupPath);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
