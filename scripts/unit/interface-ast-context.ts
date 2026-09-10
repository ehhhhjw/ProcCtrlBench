import * as fs from 'fs';
import * as path from 'path';
import { InterfaceConsistencyDetector } from '../../src/detectors/InterfaceConsistencyDetector';
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
      totalFiles: 2,
      languages: { typescript: 2 },
      totalClasses: 0,
      totalFunctions: 4,
      totalMethods: 0,
      totalProperties: 0,
      totalCalls: 2,
    },
    fileGraph: {
      'src/core/a.ts': ['src/core/b.ts'],
      'src/core/b.ts': ['src/core/a.ts'],
    },
    files: [
      createProjectFile('src/core/a.ts', ['loadAlpha', 'saveAlpha'], ['renderAlpha'], [{ target: 'src/core/b.ts', type: 'import', evidence: ['./b'] }]),
      createProjectFile('src/core/b.ts', ['loadBeta', 'saveBeta'], ['renderBeta'], [{ target: 'src/core/a.ts', type: 'import', evidence: ['./a'] }]),
    ],
  };
}

function createProjectFile(relativePath: string, functions: string[], calls: string[], relations: any[]) {
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
      calls,
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
  const totalMessages = 10;
  const stats: SessionStatistics = {
    totalMessages,
    messagesByType: { user: 0, assistant: totalMessages, attachment: 0, system: 0 },
    totalToolUses: totalMessages,
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
      content: '',
      children: [],
      toolUses: [],
      toolResults: [],
      replacements: [],
    } as any;
    session.messages.set(message.uuid, message);
  }

  for (let i = 0; i < 5; i++) {
    addTool(session, i, 'Read', { file_path: 'src/core/a.ts', offset: i }, `function loadAlpha${i}() { return saveAlpha(); }`);
  }
  for (let i = 5; i < 10; i++) {
    addTool(
      session,
      i,
      'Grep',
      { pattern: 'load', path: 'src/core/b.ts', limit: i - 4 },
      `function loadBeta${i}() { return renderBeta(); }`
    );
  }

  return session;
}

function addTool(
  session: SessionData,
  messageIndex: number,
  name: string,
  input: Record<string, unknown>,
  resultText: string
) {
  const id = `tu_${messageIndex}_${name}`;
  const toolUse: ToolUseInfo = {
    id,
    name,
    input,
    timestamp: messageIndex + 1,
    messageId: `m${messageIndex}`,
    messageUuid: `m${messageIndex}`,
    hasResult: true,
  } as any;

  session.toolUses.set(id, toolUse);
  session.messages.get(`m${messageIndex}`)!.toolUses.push(toolUse);
  session.toolResults.set(id, {
    tool_use_id: id,
    content: resultText,
    is_error: false,
  } as any);
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

async function detectSemanticOverlap(): Promise<{ overlap: number; debug: Record<string, unknown> }> {
  const detector = new InterfaceConsistencyDetector(createSession(), DEFAULT_EVALUATION_CONFIG) as any;
  const usedTools = detector.collectUsedTools();
  const analysis = detector.analyzeCluster(['Read', 'Grep'], usedTools);
  if (analysis.semanticOverlap === undefined) {
    throw new Error('未能从 file_read 集群中提取 semanticOverlap');
  }
  return {
    overlap: Number(analysis.semanticOverlap),
    debug: {
      hasProjectAst: Boolean(detector.projectAst),
      readNeighborhood: detector.projectAst?.getRelatedNeighborhood(['src/core/a.ts'], 1, true) || [],
      grepNeighborhood: detector.projectAst?.getRelatedNeighborhood(['src/core/b.ts'], 1, true) || [],
      readProfile: detector.buildContextProfile(usedTools.get('Read') || []),
      grepProfile: detector.buildContextProfile(usedTools.get('Grep') || []),
    },
  };
}

async function main() {
  const outputDir = path.join(process.cwd(), 'output');
  const projectAstPath = path.join(outputDir, 'project-ast.json');
  fs.mkdirSync(outputDir, { recursive: true });
  const backupPath = backupFile(projectAstPath);

  try {
    fs.writeFileSync(projectAstPath, JSON.stringify(createProjectAstFixture(), null, 2), 'utf-8');
    const withAst = await detectSemanticOverlap();

    if (fs.existsSync(projectAstPath)) {
      fs.unlinkSync(projectAstPath);
    }
    const withoutAst = await detectSemanticOverlap();

    if (!(withAst.overlap > withoutAst.overlap)) {
      console.error(JSON.stringify({ withAst: withAst.debug, withoutAst: withoutAst.debug }, null, 2));
      console.error(`期望项目 AST 提升工具上下文重合度估计，但得到 withAst=${withAst.overlap}, withoutAst=${withoutAst.overlap}`);
      process.exit(1);
    }

    console.log('[ok] interface-ast-context: 项目 AST 提升接口一致性中的上下文重合度判断');
  } finally {
    restoreFile(projectAstPath, backupPath);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
