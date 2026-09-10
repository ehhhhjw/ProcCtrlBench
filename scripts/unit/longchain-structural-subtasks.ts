import * as fs from 'fs';
import * as path from 'path';
import { LongChainDetector } from '../../src/detectors/LongChainDetector';
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
      totalFiles: 4,
      languages: { typescript: 4 },
      totalClasses: 0,
      totalFunctions: 4,
      totalMethods: 0,
      totalProperties: 0,
      totalCalls: 0,
    },
    fileGraph: {
      'src/core/a.ts': ['src/core/b.ts'],
      'src/core/b.ts': ['src/core/a.ts'],
      'src/ui/c.ts': ['src/ui/d.ts'],
      'src/ui/d.ts': ['src/ui/c.ts'],
    },
    files: [
      createProjectFile('src/core/a.ts', ['coreA'], [{ target: 'src/core/b.ts', type: 'import', evidence: ['./b'] }]),
      createProjectFile('src/core/b.ts', ['coreB'], [{ target: 'src/core/a.ts', type: 'import', evidence: ['./a'] }]),
      createProjectFile('src/ui/c.ts', ['uiC'], [{ target: 'src/ui/d.ts', type: 'import', evidence: ['./d'] }]),
      createProjectFile('src/ui/d.ts', ['uiD'], [{ target: 'src/ui/c.ts', type: 'import', evidence: ['./c'] }]),
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
  const totalMessages = 40;
  const stats: SessionStatistics = {
    totalMessages,
    messagesByType: { user: 0, assistant: totalMessages, attachment: 0, system: 0 },
    totalToolUses: 0,
    toolUsesByName: {},
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

  for (let i = 0; i < totalMessages; i++) {
    const message: MessageNode = {
      uuid: `m${i}`,
      messageId: `m${i}`,
      type: 'assistant',
      timestamp: i + 1,
      content: i === 4 ? 'next phase' : '',
      children: [],
      toolUses: [],
      toolResults: [],
      replacements: [],
    } as any;
    session.messages.set(message.uuid, message);
  }

  addTool(session, 0, 'Read', { file_path: 'src/core/a.ts' });
  addTool(session, 1, 'Edit', { file_path: 'src/core/a.ts' });
  addTool(session, 3, 'Bash', { command: 'verify src/core/b.ts' });
  addTool(session, 4, 'Read', { file_path: 'src/ui/c.ts' });
  addTool(session, 5, 'Edit', { file_path: 'src/ui/c.ts' });
  addTool(session, 7, 'Bash', { command: 'verify src/ui/d.ts' });

  session.statistics.totalToolUses = session.toolUses.size;
  return session;
}

function addTool(session: SessionData, messageIndex: number, name: string, input: Record<string, unknown>) {
  const id = `tu_${messageIndex}_${name}`;
  const toolUse: ToolUseInfo = {
    id,
    name,
    input,
    timestamp: messageIndex + 1,
    messageId: `m${messageIndex}`,
    messageUuid: `m${messageIndex}`,
    hasResult: false,
  } as any;

  session.toolUses.set(id, toolUse);
  session.messages.get(`m${messageIndex}`)!.toolUses.push(toolUse);
  session.statistics.toolUsesByName[name] = (session.statistics.toolUsesByName[name] || 0) + 1;
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

    const withAst = await new LongChainDetector(createSession(), DEFAULT_EVALUATION_CONFIG).detect();
    if (withAst.some((issue) => issue.metric === 'longChain')) {
      console.error('期望 AST 结构化子任务/检查点降低 LongChain 告警，但仍然命中');
      process.exit(1);
    }

    fs.unlinkSync(projectAstPath);
    const session = createSession();
    const detector = new LongChainDetector(session, DEFAULT_EVALUATION_CONFIG) as any;
    const messages = Array.from(session.messages.values()).sort((a: any, b: any) => a.timestamp - b.timestamp);
    const debugInfo = {
      explicitSubtasks: detector.identifySubtasks(messages),
      structuralSubtasks: detector.identifyStructuralSubtasks(messages),
      explicitCheckpoints: detector.identifyCheckpoints(messages),
      structuralCheckpoints: detector.identifyStructuralCheckpoints(messages),
    };
    const withoutAst = await detector.detect();
    if (!withoutAst.some((issue) => issue.metric === 'longChain')) {
      console.error(JSON.stringify(debugInfo, null, 2));
      console.error(JSON.stringify(withoutAst, null, 2));
      console.error('缺少项目 AST 时，期望命中 LongChain 告警，但未命中');
      process.exit(1);
    }

    console.log('[ok] longchain-structural-subtasks: 项目 AST 可识别隐式子任务与检查点');
  } finally {
    restoreFile(projectAstPath, backupPath);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
