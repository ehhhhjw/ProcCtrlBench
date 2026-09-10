import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { AstAnalyzer } from '../src/analyzers/AstAnalyzer';
import { loadProjectAnalysisConfig } from '../src/config/project-analysis';
import { ProjectAnalysisResult, ProjectFileAnalysis } from '../src/types/project-analysis.types';

const WORKER_REQUEST_FLAG = '--worker-request';
const WORKER_RESPONSE_FLAG = '--worker-response';
const TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  types: ['node', './src/types/externals.d.ts'],
  skipLibCheck: true,
});
const DEFAULT_BATCH_MAX_FILES = 150;
const DEFAULT_BATCH_MAX_BYTES = 8 * 1024 * 1024;

interface WorkerRequest {
  projectPath: string;
  filePaths: string[];
}

interface WorkerResponse {
  files: ProjectFileAnalysis[];
}

interface WorkerBatchLimits {
  maxFiles: number;
  maxBytes: number;
}

type WorkerBatchSuccess = { ok: true; files: ProjectFileAnalysis[] };
type WorkerBatchFailure = {
  ok: false;
  status: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  error?: Error;
};
type WorkerBatchResult = WorkerBatchSuccess | WorkerBatchFailure;

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function saveJson(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function getWorkerBatchLimits(): WorkerBatchLimits {
  return {
    maxFiles: parsePositiveInteger(process.env.PROJECT_ANALYSIS_BATCH_MAX_FILES, DEFAULT_BATCH_MAX_FILES),
    maxBytes: parsePositiveInteger(process.env.PROJECT_ANALYSIS_BATCH_MAX_BYTES, DEFAULT_BATCH_MAX_BYTES),
  };
}

function getArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

function getFileSize(filePath: string, sizeCache: Map<string, number>): number {
  const cached = sizeCache.get(filePath);
  if (typeof cached === 'number') {
    return cached;
  }

  let size = 0;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    size = 0;
  }
  sizeCache.set(filePath, size);
  return size;
}

function getBatchBytes(filePaths: string[], sizeCache: Map<string, number>): number {
  return filePaths.reduce((sum, filePath) => sum + getFileSize(filePath, sizeCache), 0);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function buildWorkerBatches(
  filePaths: string[],
  limits: WorkerBatchLimits,
  sizeCache: Map<string, number>
): string[][] {
  const batches: string[][] = [];
  let currentBatch: string[] = [];
  let currentBytes = 0;

  for (const filePath of filePaths) {
    const nextSize = getFileSize(filePath, sizeCache);
    const exceedsFileLimit = currentBatch.length >= limits.maxFiles;
    const exceedsByteLimit = currentBatch.length > 0 && currentBytes + nextSize > limits.maxBytes;

    if (exceedsFileLimit || exceedsByteLimit) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBytes = 0;
    }

    currentBatch.push(filePath);
    currentBytes += nextSize;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

function splitBatch(filePaths: string[], sizeCache: Map<string, number>): [string[], string[]] {
  if (filePaths.length <= 1) {
    return [filePaths, []];
  }

  const totalBytes = getBatchBytes(filePaths, sizeCache);
  const targetBytes = Math.max(1, Math.floor(totalBytes / 2));
  let accumulatedBytes = 0;
  let splitIndex = 0;

  while (splitIndex < filePaths.length - 1 && accumulatedBytes < targetBytes) {
    accumulatedBytes += getFileSize(filePaths[splitIndex], sizeCache);
    splitIndex += 1;
  }

  if (splitIndex <= 0 || splitIndex >= filePaths.length) {
    splitIndex = Math.ceil(filePaths.length / 2);
  }

  return [
    filePaths.slice(0, splitIndex),
    filePaths.slice(splitIndex),
  ];
}

function formatWorkerFailure(
  batch: string[],
  sizeCache: Map<string, number>,
  status: number | null,
  signal: NodeJS.Signals | null,
  stderr: string,
  error?: Error
): string {
  const parts = [
    `files=${batch.length}`,
    `bytes=${formatBytes(getBatchBytes(batch, sizeCache))}`,
  ];

  if (status !== null) {
    parts.push(`exit=${status}`);
  }
  if (signal) {
    parts.push(`signal=${signal}`);
  }
  if (error) {
    parts.push(`error=${error.message}`);
  }

  const detail = stderr.trim();
  if (detail) {
    parts.push(detail.split('\n').slice(-5).join(' | '));
  }

  return parts.join(', ');
}

function isWorkerBatchFailure(result: WorkerBatchResult): result is WorkerBatchFailure {
  return result.ok === false;
}

function runWorkerBatch(
  workerScriptPath: string,
  request: WorkerRequest
): WorkerBatchResult {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-tree-sitter-'));
  const requestPath = path.join(tempDir, 'request.json');
  const responsePath = path.join(tempDir, 'response.json');

  try {
    saveJson(requestPath, request);

    const run = spawnSync(
      process.execPath,
      [
        require.resolve('ts-node/dist/bin.js'),
        '--transpile-only',
        '-O',
        TS_NODE_COMPILER_OPTIONS,
        workerScriptPath,
        WORKER_REQUEST_FLAG,
        requestPath,
        WORKER_RESPONSE_FLAG,
        responsePath,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    if (run.error) {
      return {
        ok: false,
        status: run.status,
        signal: run.signal,
        stderr: run.stderr || '',
        error: run.error,
      };
    }

    if (run.status !== 0 || run.signal || !fs.existsSync(responsePath)) {
      return {
        ok: false,
        status: run.status,
        signal: run.signal,
        stderr: run.stderr || run.stdout || '',
      };
    }

    const parsed = JSON.parse(fs.readFileSync(responsePath, 'utf-8')) as WorkerResponse;
    return {
      ok: true,
      files: parsed.files || [],
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function analyzeBatchWithRetry(
  projectPath: string,
  filePaths: string[],
  workerScriptPath: string,
  sizeCache: Map<string, number>,
  depth = 0
): ProjectFileAnalysis[] {
  const workerResult = runWorkerBatch(workerScriptPath, {
    projectPath,
    filePaths,
  });

  if (!isWorkerBatchFailure(workerResult)) {
    return workerResult.files;
  }

  const failedResult = workerResult;

  if (filePaths.length === 1) {
    console.warn(
      `[tree-sitter] skipping unsupported file: ${filePaths[0]} (${formatWorkerFailure(
        filePaths,
        sizeCache,
        failedResult.status,
        failedResult.signal,
        failedResult.stderr,
        failedResult.error
      )})`
    );
    return [];
  }

  console.warn(
    `[tree-sitter] batch failed at depth ${depth}, retrying smaller chunks: ${formatWorkerFailure(
      filePaths,
      sizeCache,
      failedResult.status,
      failedResult.signal,
      failedResult.stderr,
      failedResult.error
    )}`
  );

  const [left, right] = splitBatch(filePaths, sizeCache);
  if (left.length === 0 || right.length === 0) {
    throw new Error(`Unable to split failing tree-sitter batch with ${filePaths.length} files`);
  }

  return [
    ...analyzeBatchWithRetry(projectPath, left, workerScriptPath, sizeCache, depth + 1),
    ...analyzeBatchWithRetry(projectPath, right, workerScriptPath, sizeCache, depth + 1),
  ];
}

async function runCoordinatorMode(configPath?: string): Promise<void> {
  const config = loadProjectAnalysisConfig(configPath);
  const projectPath = path.resolve(process.cwd(), config.projectPath);
  const outputDir = path.resolve(process.cwd(), config.outputDir);
  const workerScriptPath = path.resolve(process.argv[1]);
  const analyzer = new AstAnalyzer();
  await analyzer.init();

  const files = analyzer.collectProjectFiles(projectPath, config.includeExtensions, config.excludeDirs);
  const sizeCache = new Map<string, number>();
  const batchLimits = getWorkerBatchLimits();
  const batches = buildWorkerBatches(files, batchLimits, sizeCache);
  const analyzedFiles: ProjectFileAnalysis[] = [];

  console.log(
    `[tree-sitter] analyzing ${files.length} files with up to ${batchLimits.maxFiles} files or ${formatBytes(batchLimits.maxBytes)} per worker`
  );

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    console.log(
      `[tree-sitter] batch ${index + 1}/${batches.length}: ${batch.length} files, ${formatBytes(getBatchBytes(batch, sizeCache))}`
    );
    analyzedFiles.push(...analyzeBatchWithRetry(projectPath, batch, workerScriptPath, sizeCache));
  }

  const result: ProjectAnalysisResult = analyzer.buildProjectAnalysisResult(projectPath, analyzedFiles, {
    includeExtensions: config.includeExtensions,
    excludeDirs: config.excludeDirs,
    enableSymbolRelations: config.enableSymbolRelations,
    relatedFilesDataPath: config.relatedFilesDataPath,
  });

  result.config = {
    ...config,
    projectPath,
    outputDir,
  };

  const fileGraphPath = path.join(outputDir, config.outputFiles.fileGraph);
  const projectAstPath = path.join(outputDir, config.outputFiles.projectAst);

  saveJson(fileGraphPath, result.fileGraph);
  saveJson(projectAstPath, result);

  console.log(`Analyzed project: ${projectPath}`);
  console.log(`Files parsed: ${result.summary.totalFiles}`);
  console.log(`Saved file graph to ${fileGraphPath}`);
  console.log(`Saved project AST to ${projectAstPath}`);
}

async function runWorkerMode(requestPath: string, responsePath: string): Promise<void> {
  const request = JSON.parse(fs.readFileSync(requestPath, 'utf-8')) as WorkerRequest;
  const analyzer = new AstAnalyzer();
  await analyzer.init();
  const files = analyzer.analyzeProjectFiles(request.projectPath, request.filePaths);
  saveJson(responsePath, { files } satisfies WorkerResponse);
}

(async function main() {
  const workerRequestPath = getArgValue(WORKER_REQUEST_FLAG);
  const workerResponsePath = getArgValue(WORKER_RESPONSE_FLAG);

  if (workerRequestPath && workerResponsePath) {
    await runWorkerMode(workerRequestPath, workerResponsePath);
    return;
  }

  const configPath = process.argv[2];
  await runCoordinatorMode(configPath);
})().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
