import * as fs from 'fs';
import * as path from 'path';

export interface SharedModelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AcoderConfig {
  enabled: boolean;
  bin: string;
  agent: 'auto' | 'claude' | 'codex' | 'opencode' | 'qoder';
  yolo: boolean;
  debug: boolean;
  noBanner: boolean;
  noUpgrade: boolean;
  timeoutSec: number;
}

export interface AndroidBenchConfig {
  enabled: boolean;
  repoPath: string;
  tasksFilter: string;
  workers: number;
  images: 'local' | 'remote';
  runNamePrefix: string;
  providerPrefix: string;
}

export interface TerminalBenchConfig {
  enabled: boolean;
  repoPath: string;
  agent: 'auto' | 'openhands' | 'qwen-coder';
  datasetName: string;
  datasetVersion: string;
  nConcurrent: number;
  globalTimeoutMultiplier: number;
  globalAgentTimeoutSec: number | null;
  globalTestTimeoutSec: number | null;
  cleanup: boolean;
  outputPath: string;
}

export interface SweBenchVerifiedConfig {
  enabled: boolean;
  projectsRoot: string;
  questionsPath: string;
  experimentsRoot: string;
  scaffold: 'openhands' | 'swe-agent';
  providerPrefix: string;
}

export interface BenchmarkRunConfig {
  version: number;
  model: SharedModelConfig;
  acoder: AcoderConfig;
  benchmarks: {
    androidBench: AndroidBenchConfig;
    terminalBench: TerminalBenchConfig;
    sweBenchVerified: SweBenchVerifiedConfig;
  };
}

export interface GeneratedFile {
  relativePath: string;
  content: string;
}

export interface BenchmarkLaunchArtifact {
  benchmarkId: 'android-bench' | 'terminal-bench' | 'swe-bench-verified';
  enabled: boolean;
  resolvedModel: string;
  env: Record<string, string>;
  command: string;
  files: GeneratedFile[];
  notes: string[];
  warnings: string[];
}

type RawConfig = {
  version?: number;
  model?: {
    base_url?: string;
    api_key?: string;
    model?: string;
  };
  acoder?: Partial<{
    enabled: boolean;
    bin: string;
    agent: 'auto' | 'claude' | 'codex' | 'opencode' | 'qoder';
    yolo: boolean;
    debug: boolean;
    no_banner: boolean;
    no_upgrade: boolean;
    timeout_sec: number;
  }>;
  benchmarks?: {
    android_bench?: Partial<{
      enabled: boolean;
      repo_path: string;
      tasks_filter: string;
      workers: number;
      images: 'local' | 'remote';
      run_name_prefix: string;
      provider_prefix: string;
    }>;
    terminal_bench?: Partial<{
      enabled: boolean;
      repo_path: string;
      agent: 'auto' | 'openhands' | 'qwen-coder';
      dataset_name: string;
      dataset_version: string;
      n_concurrent: number;
      global_timeout_multiplier: number;
      global_agent_timeout_sec: number | null;
      global_test_timeout_sec: number | null;
      cleanup: boolean;
      output_path: string;
    }>;
    swe_bench_verified?: Partial<{
      enabled: boolean;
      projects_root: string;
      questions_path: string;
      experiments_root: string;
      scaffold: 'openhands' | 'swe-agent';
      provider_prefix: string;
    }>;
  };
};

/**
 * Dataset and external repository locations vary from machine to machine, so
 * defaults are read from environment variables and fall back to relative
 * placeholder paths outside the repository when unset. Specify the real paths
 * via config/benchmark-model.config.yaml or the corresponding environment
 * variables.
 */
function envPath(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : fallback;
}

const DEFAULT_BENCHMARK_RUN_CONFIG: BenchmarkRunConfig = {
  version: 1,
  model: {
    baseUrl: '',
    apiKey: '',
    model: '',
  },
  acoder: {
    enabled: true,
    bin: 'acoder',
    agent: 'auto',
    yolo: true,
    debug: false,
    noBanner: true,
    noUpgrade: true,
    timeoutSec: 1800,
  },
  benchmarks: {
    androidBench: {
      enabled: true,
      repoPath: envPath('PROCCTRL_ANDROID_BENCH_REPO', '../android-bench'),
      tasksFilter: 'dataset/tasks/v1_tasks.yaml',
      workers: 4,
      images: 'local',
      runNamePrefix: 'procbench',
      providerPrefix: 'openai',
    },
    terminalBench: {
      enabled: true,
      repoPath: '/tmp/terminal-bench',
      agent: 'auto',
      datasetName: 'terminal-bench-core',
      datasetVersion: '0.1.1',
      nConcurrent: 8,
      globalTimeoutMultiplier: 1,
      globalAgentTimeoutSec: null,
      globalTestTimeoutSec: null,
      cleanup: true,
      outputPath: 'runs',
    },
    sweBenchVerified: {
      enabled: true,
      projectsRoot: envPath(
        'PROCCTRL_SWEBENCH_PROJECTS_ROOT',
        '../swebench_verified_projects/projects'
      ),
      questionsPath: envPath(
        'PROCCTRL_SWEBENCH_QUESTIONS',
        '../swebench_verified_projects/instance_questions.json'
      ),
      experimentsRoot: envPath(
        'PROCCTRL_SWEBENCH_EXPERIMENTS_ROOT',
        '../swe-bench-experiments/evaluation/verified'
      ),
      scaffold: 'openhands',
      providerPrefix: 'openai',
    },
  },
};

export function loadBenchmarkRunConfig(configPath?: string): BenchmarkRunConfig {
  const resolvedConfigPath = configPath
    ? path.resolve(process.cwd(), configPath)
    : path.resolve(process.cwd(), 'config/benchmark-model.config.yaml');

  if (!fs.existsSync(resolvedConfigPath)) {
    return DEFAULT_BENCHMARK_RUN_CONFIG;
  }

  const rawText = fs.readFileSync(resolvedConfigPath, 'utf-8');
  const parsed = parseConfigText(rawText) as RawConfig;

  const merged: BenchmarkRunConfig = {
    version: parsed.version ?? DEFAULT_BENCHMARK_RUN_CONFIG.version,
    model: {
      baseUrl: resolveEnvPlaceholders(
        parsed.model?.base_url ?? DEFAULT_BENCHMARK_RUN_CONFIG.model.baseUrl
      ),
      apiKey: resolveEnvPlaceholders(
        parsed.model?.api_key ?? DEFAULT_BENCHMARK_RUN_CONFIG.model.apiKey
      ),
      model: resolveEnvPlaceholders(
        parsed.model?.model ?? DEFAULT_BENCHMARK_RUN_CONFIG.model.model
      ),
    },
    acoder: {
      ...DEFAULT_BENCHMARK_RUN_CONFIG.acoder,
      enabled: parsed.acoder?.enabled ?? DEFAULT_BENCHMARK_RUN_CONFIG.acoder.enabled,
      bin: resolveEnvPlaceholders(
        parsed.acoder?.bin ?? DEFAULT_BENCHMARK_RUN_CONFIG.acoder.bin
      ),
      agent: parsed.acoder?.agent ?? DEFAULT_BENCHMARK_RUN_CONFIG.acoder.agent,
      yolo: parsed.acoder?.yolo ?? DEFAULT_BENCHMARK_RUN_CONFIG.acoder.yolo,
      debug: parsed.acoder?.debug ?? DEFAULT_BENCHMARK_RUN_CONFIG.acoder.debug,
      noBanner:
        parsed.acoder?.no_banner ?? DEFAULT_BENCHMARK_RUN_CONFIG.acoder.noBanner,
      noUpgrade:
        parsed.acoder?.no_upgrade ?? DEFAULT_BENCHMARK_RUN_CONFIG.acoder.noUpgrade,
      timeoutSec:
        parsed.acoder?.timeout_sec ?? DEFAULT_BENCHMARK_RUN_CONFIG.acoder.timeoutSec,
    },
    benchmarks: {
      androidBench: {
        ...DEFAULT_BENCHMARK_RUN_CONFIG.benchmarks.androidBench,
        enabled:
          parsed.benchmarks?.android_bench?.enabled ??
          DEFAULT_BENCHMARK_RUN_CONFIG.benchmarks.androidBench.enabled,
        repoPath: resolveEnvPlaceholders(
          parsed.benchmarks?.android_bench?.repo_path ??
            DEFAULT_BENCHMARK_RUN_CONFIG.benchmarks.androidBench.repoPath
        ),
        tasksFilter: resolveEnvPlaceholders(
          parsed.benchmarks?.android_bench?.tasks_filter ??
            DEFAULT_BENCHMARK_RUN_CONFIG.benchmarks.androidBench.tasksFilter
        ),
        workers:
          parsed.benchmarks?.android_bench?.workers ??
          DEFAULT_BENCHMARK_RUN_CONFIG.benchmarks.androidBench.workers,
        images:
          parsed.benchmarks?.android_bench?.images ??
          DEFAULT_BENCHMARK_RUN_CONFIG.benchmarks.androidBench.images,
        runNamePrefix: resolveEnvPlaceholders(
          parsed.benchmarks?.android_bench?.run_name_prefix ??
            DEFAULT_BENCHMARK_RUN_CONFIG.benchmarks.androidBench.runNamePrefix
        ),
        providerPrefix: resolveEnvPlaceholders(
          parsed.benchmarks?.android_bench?.provider_prefix ??
            DEFAULT_BENCHMARK_RUN_CONFIG.benchmarks.androidBench.providerPrefix
        ),
      },
      terminalBench: {
        ...DEFAULT_BENCHMARK_RUN_CONFIG.benchmarks.terminalBench,
        enabled:
          parsed.benchmarks?.terminal_bench?.enabled ??
          DEFAULT_BENCHMARK_RUN_CONFIG.benchmarks.terminalBench.enabled,
        repoPath: resolveEnvPlaceholders(
          parsed.benchmarks?.terminal_bench?.repo_path ??
            DEFAULT_BENCHMARK_RUN_CONFIG.benchmarks.terminalBench.repoPath
        ),
        agent:
          parsed.benchmarks?.terminal_bench?.agent ??
          DEFAULT_BENCHMARK_RUN_CONFIG.benchmarks.terminalBench.agent,
        datasetName: resolveEnvPlaceholders(
          parsed.benchmarks?.terminal_bench?.dataset_name ??
            DEFAULT_BENCHMARK_RUN_CONFIG.benchmarks.terminalBench.datasetName
        ),
        datasetVersion: resolveEnvPlaceholders(
          parsed.benchmarks?.terminal_bench?.dataset_version ??
            DEFAULT_BENCHMARK_RUN_CONFIG.benchmarks.terminalBench.datasetVersion
        ),
        nConcurrent:
          parsed.benchmarks?.terminal_bench?.n_concurrent ??
          DEFAULT_BENCHMARK_RUN_CONFIG.benchmarks.terminalBench.nConcurrent,
        globalTimeoutMultiplier:
          parsed.benchmarks?.terminal_bench?.global_timeout_multiplier ??
          DEFAULT_BENCHMARK_RUN_CONFIG.benchmarks.terminalBench.globalTimeoutMultiplier,
        globalAgentTimeoutSec:
          parsed.benchmarks?.terminal_bench?.global_agent_timeout_sec ??
          DEFAULT_BENCHMARK_RUN_CONFIG.benchmarks.terminalBench.globalAgentTimeoutSec,
        globalTestTimeoutSec:
          parsed.benchmarks?.terminal_bench?.global_test_timeout_sec ??
          DEFAULT_BENCHMARK_RUN_CONFIG.benchmarks.terminalBench.globalTestTimeoutSec,
        cleanup:
          parsed.benchmarks?.terminal_bench?.cleanup ??
          DEFAULT_BENCHMARK_RUN_CONFIG.benchmarks.terminalBench.cleanup,
        outputPath: resolveEnvPlaceholders(
          parsed.benchmarks?.terminal_bench?.output_path ??
            DEFAULT_BENCHMARK_RUN_CONFIG.benchmarks.terminalBench.outputPath
        ),
      },
      sweBenchVerified: {
        ...DEFAULT_BENCHMARK_RUN_CONFIG.benchmarks.sweBenchVerified,
        enabled:
          parsed.benchmarks?.swe_bench_verified?.enabled ??
          DEFAULT_BENCHMARK_RUN_CONFIG.benchmarks.sweBenchVerified.enabled,
        projectsRoot: resolveEnvPlaceholders(
          parsed.benchmarks?.swe_bench_verified?.projects_root ??
            DEFAULT_BENCHMARK_RUN_CONFIG.benchmarks.sweBenchVerified.projectsRoot
        ),
        questionsPath: resolveEnvPlaceholders(
          parsed.benchmarks?.swe_bench_verified?.questions_path ??
            DEFAULT_BENCHMARK_RUN_CONFIG.benchmarks.sweBenchVerified.questionsPath
        ),
        experimentsRoot: resolveEnvPlaceholders(
          parsed.benchmarks?.swe_bench_verified?.experiments_root ??
            DEFAULT_BENCHMARK_RUN_CONFIG.benchmarks.sweBenchVerified.experimentsRoot
        ),
        scaffold:
          parsed.benchmarks?.swe_bench_verified?.scaffold ??
          DEFAULT_BENCHMARK_RUN_CONFIG.benchmarks.sweBenchVerified.scaffold,
        providerPrefix: resolveEnvPlaceholders(
          parsed.benchmarks?.swe_bench_verified?.provider_prefix ??
            DEFAULT_BENCHMARK_RUN_CONFIG.benchmarks.sweBenchVerified.providerPrefix
        ),
      },
    },
  };

  validateConfig(merged, resolvedConfigPath);
  return merged;
}

export function buildBenchmarkLaunchArtifacts(
  config: BenchmarkRunConfig,
  options?: {
    outputDir?: string;
  }
): BenchmarkLaunchArtifact[] {
  const resolvedOutputDir = path.resolve(
    process.cwd(),
    options?.outputDir || path.join('output', 'benchmark-run-configs')
  );
  return [
    buildAndroidBenchArtifact(config, resolvedOutputDir),
    buildTerminalBenchArtifact(config),
    buildSweBenchArtifact(config),
  ];
}

export function writeBenchmarkLaunchArtifacts(
  artifacts: BenchmarkLaunchArtifact[],
  outputDir: string
): void {
  const resolvedOutputDir = path.resolve(process.cwd(), outputDir);
  fs.mkdirSync(resolvedOutputDir, { recursive: true });

  const summary = artifacts.map((artifact) => ({
    benchmarkId: artifact.benchmarkId,
    enabled: artifact.enabled,
    resolvedModel: artifact.resolvedModel,
    envKeys: Object.keys(artifact.env),
    command: artifact.command,
    notes: artifact.notes,
    warnings: artifact.warnings,
  }));

  for (const artifact of artifacts) {
    const benchmarkDir = path.join(resolvedOutputDir, artifact.benchmarkId);
    fs.mkdirSync(benchmarkDir, { recursive: true });

    for (const file of artifact.files) {
      const targetPath = path.join(benchmarkDir, file.relativePath);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, file.content, 'utf-8');
    }

    fs.writeFileSync(
      path.join(benchmarkDir, 'manifest.json'),
      JSON.stringify(summary.find((item) => item.benchmarkId === artifact.benchmarkId), null, 2),
      'utf-8'
    );
  }

  fs.writeFileSync(
    path.join(resolvedOutputDir, 'summary.json'),
    JSON.stringify(summary, null, 2),
    'utf-8'
  );
}

function buildAndroidBenchArtifact(
  config: BenchmarkRunConfig,
  outputDir: string
): BenchmarkLaunchArtifact {
  const benchmark = config.benchmarks.androidBench;
  const resolvedModel = withProviderPrefix(config.model.model, benchmark.providerPrefix);
  const env = buildSharedBenchmarkEnv(config, resolvedModel);

  const androidYaml = [
    'model:',
    `  model_name: "${escapeYamlDoubleQuoted(resolvedModel)}"`,
    '  model_kwargs:',
    `    api_key: "${escapeYamlDoubleQuoted(config.model.apiKey)}"`,
    `    api_base: "${escapeYamlDoubleQuoted(config.model.baseUrl)}"`,
    '    drop_params: true',
    '',
  ].join('\n');

  const generatedConfigPath = path.join(outputDir, 'android-bench', 'androidbench.generated.yaml');

  const baseCommand =
    `uv run python harness/inference/androidbench.py ` +
    `--config ${shellQuote(generatedConfigPath)} ` +
    `--model ${shellQuote(resolvedModel)} ` +
    `--workers ${benchmark.workers} ` +
    `--tasks-filter ${shellQuote(benchmark.tasksFilter)} ` +
    `--images ${shellQuote(benchmark.images)}`;
  const command = `cd ${shellQuote(benchmark.repoPath)} && ${baseCommand}`;

  const warnings = collectPathWarnings([
    {
      label: 'AndroidBench repo',
      filePath: benchmark.repoPath,
    },
  ]);

  if (config.acoder.enabled) {
    return {
      benchmarkId: 'android-bench',
      enabled: benchmark.enabled,
      resolvedModel,
      env,
      command:
        `${command} ` +
        `--model-class 'acoder_android_model.AcoderMiniSweAgentModel'`,
      notes: [
        'AndroidBench keeps the native harness, but swaps the model backend to a generated acoder bridge.',
        'The launcher checks local acoder first, then exposes the generated Python module through PYTHONPATH.',
        'This path uses acoder as a local CLI-backed responder inside mini-swe-agent, so AndroidBench still writes native trajectories and patches.',
      ],
      warnings,
      files: [
        {
          relativePath: 'env.sh',
          content: renderEnvScript(env),
        },
        {
          relativePath: 'androidbench.generated.yaml',
          content: androidYaml,
        },
        {
          relativePath: 'acoder_android_model.py',
          content: renderAndroidBenchAcoderModelModule(),
        },
        {
          relativePath: 'launch.sh',
          content: renderBenchmarkLaunchScript(
            benchmark.repoPath,
            [
              'export PYTHONPATH="$SCRIPT_DIR${PYTHONPATH:+:$PYTHONPATH}"',
              `uv run python harness/inference/androidbench.py ` +
                `--config "$SCRIPT_DIR/androidbench.generated.yaml" ` +
                `--model ${shellQuote(resolvedModel)} ` +
                `--model-class 'acoder_android_model.AcoderMiniSweAgentModel' ` +
                `--workers ${benchmark.workers} ` +
                `--tasks-filter ${shellQuote(benchmark.tasksFilter)} ` +
                `--images ${shellQuote(benchmark.images)}`,
            ].join('\n'),
            renderAcoderPreflightLines()
          ),
        },
      ],
    };
  }

  return {
    benchmarkId: 'android-bench',
    enabled: benchmark.enabled,
    resolvedModel,
    env,
    command,
    notes: [
      'AndroidBench uses the native harness and a generated androidbench YAML file.',
      'The launcher uses `uv run python ...` so AndroidBench resolves repository-managed dependencies such as minisweagent.',
      'The generated YAML redundantly includes api_key/api_base and the env script exports OPENAI_* variables for OpenAI-compatible backends.',
    ],
    warnings,
    files: [
      {
        relativePath: 'env.sh',
        content: renderEnvScript(env),
      },
      {
        relativePath: 'androidbench.generated.yaml',
        content: androidYaml,
      },
      {
        relativePath: 'launch.sh',
        content: renderBenchmarkLaunchScript(
          benchmark.repoPath,
          `uv run python harness/inference/androidbench.py ` +
            `--config "$SCRIPT_DIR/androidbench.generated.yaml" ` +
            `--model ${shellQuote(resolvedModel)} ` +
            `--workers ${benchmark.workers} ` +
            `--tasks-filter ${shellQuote(benchmark.tasksFilter)} ` +
            `--images ${shellQuote(benchmark.images)}`
        ),
      },
    ],
  };
}

function buildTerminalBenchArtifact(config: BenchmarkRunConfig): BenchmarkLaunchArtifact {
  const benchmark = config.benchmarks.terminalBench;
  const terminalAgent = resolveTerminalBenchAgent(benchmark.agent, config.model.model);
  const useQwenAgent = terminalAgent === 'qwen-coder';
  const resolvedModel = useQwenAgent
    ? withProviderPrefix(config.model.model, 'qwen')
    : config.model.model;
  const env = buildSharedBenchmarkEnv(config, resolvedModel);

  const commandParts = [
    `cd ${shellQuote(benchmark.repoPath)} &&`,
    'uv run tb run',
    `--agent ${shellQuote(terminalAgent)}`,
    `--model ${shellQuote(resolvedModel)}`,
    `--dataset-name ${shellQuote(benchmark.datasetName)}`,
    `--dataset-version ${shellQuote(benchmark.datasetVersion)}`,
    `--n-concurrent ${benchmark.nConcurrent}`,
    `--output-path ${shellQuote(benchmark.outputPath)}`,
  ];

  if (benchmark.globalTimeoutMultiplier !== 1) {
    commandParts.push(`--global-timeout-multiplier ${benchmark.globalTimeoutMultiplier}`);
  }
  if (typeof benchmark.globalAgentTimeoutSec === 'number') {
    commandParts.push(`--global-agent-timeout-sec ${benchmark.globalAgentTimeoutSec}`);
  }
  if (typeof benchmark.globalTestTimeoutSec === 'number') {
    commandParts.push(`--global-test-timeout-sec ${benchmark.globalTestTimeoutSec}`);
  }

  if (benchmark.cleanup) {
    commandParts.push('--cleanup');
  }

  if (useQwenAgent) {
    commandParts.push(`--agent-kwarg ${shellQuote(`api_key=${config.model.apiKey}`)}`);
    commandParts.push(`--agent-kwarg ${shellQuote(`base_url=${config.model.baseUrl}`)}`);
  }

  const command = commandParts.join(' ');
  const warnings = collectPathWarnings([
    {
      label: 'TerminalBench repo',
      filePath: benchmark.repoPath,
    },
  ]);

  if (benchmark.agent === 'qwen-coder' && !looksLikeQwenModel(config.model.model)) {
    warnings.push(
      `terminal_bench.agent is qwen-coder but model "${config.model.model}" does not look like a Qwen model.`
    );
  }

  if (config.acoder.enabled) {
    const resolvedAcoderAgent = resolveAcoderAgent(config.acoder.agent, config.model.model);
    const terminalAcoderModel = resolveAcoderModel(config.model.model, resolvedAcoderAgent);
    const acoderCommandParts = [
      'uv run tb run',
      `--agent-import-path 'acoder_terminal_agent:AcoderTerminalBenchAgent'`,
      `--model ${shellQuote(terminalAcoderModel)}`,
      `--dataset-name ${shellQuote(benchmark.datasetName)}`,
      `--dataset-version ${shellQuote(benchmark.datasetVersion)}`,
      `--n-concurrent ${benchmark.nConcurrent}`,
      `--output-path ${shellQuote(benchmark.outputPath)}`,
      `--agent-kwarg ${shellQuote(`delegate_agent=${resolvedAcoderAgent}`)}`,
      `--agent-kwarg ${shellQuote('acoder_bin=acoder')}`,
      `--agent-kwarg "acoder_version=\${PROC_BENCH_ACODER_HOST_VERSION:-latest}"`,
      `--agent-kwarg ${shellQuote(`acoder_yolo=${config.acoder.yolo}`)}`,
      `--agent-kwarg ${shellQuote(`acoder_debug=${config.acoder.debug}`)}`,
      `--agent-kwarg ${shellQuote(`acoder_no_banner=${config.acoder.noBanner}`)}`,
      `--agent-kwarg ${shellQuote(`acoder_no_upgrade=${config.acoder.noUpgrade}`)}`,
    ];

    if (benchmark.globalTimeoutMultiplier !== 1) {
      acoderCommandParts.push(`--global-timeout-multiplier ${benchmark.globalTimeoutMultiplier}`);
    }
    if (typeof benchmark.globalAgentTimeoutSec === 'number') {
      acoderCommandParts.push(`--global-agent-timeout-sec ${benchmark.globalAgentTimeoutSec}`);
    }
    if (typeof benchmark.globalTestTimeoutSec === 'number') {
      acoderCommandParts.push(`--global-test-timeout-sec ${benchmark.globalTestTimeoutSec}`);
    }
    if (benchmark.cleanup) {
      acoderCommandParts.push('--cleanup');
    }

    return {
      benchmarkId: 'terminal-bench',
      enabled: benchmark.enabled,
      resolvedModel: terminalAcoderModel,
      env,
      command: [`cd ${shellQuote(benchmark.repoPath)} &&`, ...acoderCommandParts].join(' '),
      notes: [
        `TerminalBench resolves acoder delegate agent as ${resolvedAcoderAgent}.`,
        'The launcher checks local acoder on the host, captures its version, and the generated custom TerminalBench agent installs the same acoder version inside the task client container.',
        typeof benchmark.globalTestTimeoutSec === 'number'
          ? `Global test timeout override enabled: ${benchmark.globalTestTimeoutSec}s.`
          : 'TerminalBench uses per-task test timeouts from the dataset unless a global override is configured.',
      ],
      warnings,
      files: [
        {
          relativePath: 'env.sh',
          content: renderEnvScript(env),
        },
        {
          relativePath: 'acoder_terminal_agent.py',
          content: renderTerminalBenchAcoderAgentModule(),
        },
        {
          relativePath: 'launch.sh',
          content: renderBenchmarkLaunchScript(
            benchmark.repoPath,
            'export PYTHONPATH="$SCRIPT_DIR${PYTHONPATH:+:$PYTHONPATH}"\n' +
              acoderCommandParts.join(' '),
            [
              'unset VIRTUAL_ENV',
              ...renderAcoderPreflightLines(),
              'if ! command -v docker >/dev/null 2>&1; then',
              '  echo "Docker CLI not found. Install Docker Desktop and retry." >&2',
              '  exit 1',
              'fi',
              'if ! docker info >/dev/null 2>&1; then',
              '  echo "Docker daemon is not running. Start Docker Desktop and retry." >&2',
              '  exit 1',
              'fi',
            ]
          ),
        },
      ],
    };
  }

  return {
    benchmarkId: 'terminal-bench',
    enabled: benchmark.enabled,
    resolvedModel,
    env,
    command,
    notes: [
      terminalAgent === 'openhands'
        ? 'TerminalBench uses the OpenHands agent for generic OpenAI-compatible models.'
        : 'TerminalBench uses the native qwen-coder agent for Qwen-family models.',
      benchmark.agent === 'auto'
        ? `Auto-selected terminal agent: ${terminalAgent}.`
        : `Configured terminal agent: ${terminalAgent}.`,
      typeof benchmark.globalTestTimeoutSec === 'number'
        ? `Global test timeout override enabled: ${benchmark.globalTestTimeoutSec}s.`
        : 'TerminalBench uses per-task test timeouts from the dataset unless a global override is configured.',
    ],
    warnings,
    files: [
      {
        relativePath: 'env.sh',
        content: renderEnvScript(env),
      },
      {
        relativePath: 'launch.sh',
        content: renderBenchmarkLaunchScript(
          benchmark.repoPath,
          [
            'uv run tb run',
            `--agent ${shellQuote(terminalAgent)}`,
            `--model ${shellQuote(resolvedModel)}`,
            `--dataset-name ${shellQuote(benchmark.datasetName)}`,
            `--dataset-version ${shellQuote(benchmark.datasetVersion)}`,
            `--n-concurrent ${benchmark.nConcurrent}`,
            `--output-path ${shellQuote(benchmark.outputPath)}`,
            benchmark.globalTimeoutMultiplier !== 1
              ? `--global-timeout-multiplier ${benchmark.globalTimeoutMultiplier}`
              : '',
            typeof benchmark.globalAgentTimeoutSec === 'number'
              ? `--global-agent-timeout-sec ${benchmark.globalAgentTimeoutSec}`
              : '',
            typeof benchmark.globalTestTimeoutSec === 'number'
              ? `--global-test-timeout-sec ${benchmark.globalTestTimeoutSec}`
              : '',
            benchmark.cleanup ? '--cleanup' : '',
            useQwenAgent ? `--agent-kwarg ${shellQuote(`api_key=${config.model.apiKey}`)}` : '',
            useQwenAgent ? `--agent-kwarg ${shellQuote(`base_url=${config.model.baseUrl}`)}` : '',
          ]
            .filter(Boolean)
            .join(' '),
          [
            'unset VIRTUAL_ENV',
            'if ! command -v docker >/dev/null 2>&1; then',
            '  echo "Docker CLI not found. Install Docker Desktop and retry." >&2',
            '  exit 1',
            'fi',
            'if ! docker info >/dev/null 2>&1; then',
            '  echo "Docker daemon is not running. Start Docker Desktop and retry." >&2',
            '  exit 1',
            'fi',
          ]
        ),
      },
    ],
  };
}

function buildSweBenchArtifact(config: BenchmarkRunConfig): BenchmarkLaunchArtifact {
  const benchmark = config.benchmarks.sweBenchVerified;
  const resolvedModel = withProviderPrefix(config.model.model, benchmark.providerPrefix);
  const env = buildSharedBenchmarkEnv(config, resolvedModel);

  const command = [
    '# This workspace does not ship a native SWE-bench inference runner.',
    '# Use the env file below with your chosen scaffold (for example OpenHands or SWE-agent).',
    benchmark.scaffold === 'openhands'
      ? '# Suggested scaffold variables: LLM_API_KEY / LLM_BASE_URL / LLM_MODEL'
      : '# Suggested scaffold variables: OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL',
    `# Resolved model hint: ${resolvedModel}`,
  ].join('\n');

  const warnings = collectPathWarnings([
    {
      label: 'SWE-bench verified projects root',
      filePath: benchmark.projectsRoot,
    },
    {
      label: 'SWE-bench verified questions file',
      filePath: benchmark.questionsPath,
    },
    {
      label: 'SWE-bench experiments root',
      filePath: benchmark.experimentsRoot,
    },
  ]);

  const manifest = {
    scaffold: benchmark.scaffold,
    resolvedModel,
    projectsRoot: benchmark.projectsRoot,
    questionsPath: benchmark.questionsPath,
    experimentsRoot: benchmark.experimentsRoot,
    env,
  };

  if (config.acoder.enabled) {
    return {
      benchmarkId: 'swe-bench-verified',
      enabled: benchmark.enabled,
      resolvedModel,
      env,
      command:
        `cd ${shellQuote(benchmark.projectsRoot)} && ` +
        `python3 ${shellQuote(path.join('output', 'benchmark-run-configs', 'swe-bench-verified', 'swebench_verified_runner.py'))}`,
      notes: [
        'SWE-bench-Verified now generates a local acoder batch runner over project directories.',
        'The runner enters each instance project directory, sends only problem_statement to local acoder, and stores assistant stdout/stderr plus result_patch.diff.',
        'This repository still does not bundle the full official SWE-bench environment builder, so the generated runner standardizes acoder execution artifacts rather than claiming native official resolution metrics.',
      ],
      warnings,
      files: [
        {
          relativePath: 'env.sh',
          content: renderEnvScript(env),
        },
        {
          relativePath: 'swebench_verified_runner.py',
          content: renderSweBenchAcoderRunner(),
        },
        {
          relativePath: 'launch.sh',
          content: renderBenchmarkLaunchScript(
            benchmark.projectsRoot,
            [
              'PYTHONUNBUFFERED=1 exec python3 -u "$SCRIPT_DIR/swebench_verified_runner.py"',
              `--projects-root ${shellQuote(benchmark.projectsRoot)}`,
              `--questions-path ${shellQuote(benchmark.questionsPath)}`,
              `--experiments-root ${shellQuote(benchmark.experimentsRoot)}`,
              `--output-dir "$SCRIPT_DIR/runs"`,
              '"$@"',
            ].join(' '),
            renderAcoderPreflightLines()
          ),
        },
        {
          relativePath: 'runner-manifest.json',
          content: JSON.stringify(
            {
              ...manifest,
              acoderCommandStyle: 'acoder -y -- "<problem_statement>"',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  warnings.push(
    'This workspace currently contains SWE-bench data/trajectory assets but not a native runnable SWE-bench inference harness. The generated launch file is a scaffold template, not an executable benchmark runner.'
  );

  return {
    benchmarkId: 'swe-bench-verified',
    enabled: benchmark.enabled,
    resolvedModel,
    env,
    command,
    notes: [
      'The model triple is normalized once and then exported into scaffold-friendly environment variables.',
      'Use this generated manifest as the single source of truth when wiring a separate SWE-agent/OpenHands runner.',
    ],
    warnings,
    files: [
      {
        relativePath: 'env.sh',
        content: renderEnvScript(env),
      },
      {
        relativePath: 'launch.template.sh',
        content: renderBenchmarkLaunchScript(
          benchmark.projectsRoot,
          `cat <<'EOF'\n${command}\nEOF`
        ),
      },
      {
        relativePath: 'runner-manifest.json',
        content: JSON.stringify(manifest, null, 2),
      },
    ],
  };
}

function buildSharedBenchmarkEnv(
  config: BenchmarkRunConfig,
  resolvedModel: string
): Record<string, string> {
  const resolvedAcoderAgent = resolveAcoderAgent(config.acoder.agent, config.model.model);
  return {
    ACODER_BIN: config.acoder.bin,
    OPENAI_API_KEY: config.model.apiKey,
    OPENAI_BASE_URL: config.model.baseUrl,
    OPENAI_MODEL: config.model.model,
    LLM_API_KEY: config.model.apiKey,
    LLM_BASE_URL: config.model.baseUrl,
    LLM_MODEL: config.model.model,
    ANTHROPIC_API_KEY: config.model.apiKey,
    ANTHROPIC_MODEL: stripModelProvider(config.model.model),
    PROC_BENCH_MODEL: config.model.model,
    PROC_BENCH_RESOLVED_MODEL: resolvedModel,
    PROC_BENCH_ACODER_ENABLED: String(config.acoder.enabled),
    PROC_BENCH_ACODER_AGENT: resolvedAcoderAgent,
    PROC_BENCH_ACODER_YOLO: String(config.acoder.yolo),
    PROC_BENCH_ACODER_DEBUG: String(config.acoder.debug),
    PROC_BENCH_ACODER_NO_BANNER: String(config.acoder.noBanner),
    PROC_BENCH_ACODER_NO_UPGRADE: String(config.acoder.noUpgrade),
    PROC_BENCH_ACODER_TIMEOUT_SEC: String(config.acoder.timeoutSec),
    PROC_BENCH_ACODER_TRUST_RESPONSE: '1',
  };
}

function resolveAcoderAgent(
  configuredAgent: AcoderConfig['agent'],
  model: string
): 'claude' | 'codex' | 'opencode' | 'qoder' {
  if (configuredAgent !== 'auto') {
    return configuredAgent;
  }
  if (looksLikeClaudeModel(model)) {
    return 'claude';
  }
  if (looksLikeQwenModel(model)) {
    return 'opencode';
  }
  if (looksLikeGptModel(model)) {
    return 'codex';
  }
  return 'opencode';
}

function resolveAcoderModel(
  model: string,
  agent: 'claude' | 'codex' | 'opencode' | 'qoder',
  defaultProvider = 'openai'
): string {
  if (agent === 'opencode' && !model.includes('/')) {
    return `${defaultProvider}/${model}`;
  }
  return model;
}

function stripModelProvider(model: string): string {
  const segments = model.split('/');
  return segments[segments.length - 1];
}

function renderAcoderPreflightLines(): string[] {
  return [
    'if [ "${PROC_BENCH_ACODER_ENABLED}" = "true" ]; then',
    '  if ! command -v "$ACODER_BIN" >/dev/null 2>&1; then',
    '    echo "acoder not found in PATH. Install acoder locally and retry." >&2',
    '    exit 1',
    '  fi',
    '  PROC_BENCH_ACODER_HOST_VERSION="$($ACODER_BIN --version 2>/dev/null | head -n 1 | tr -d \'\\r\')"',
    '  if [ -z "${PROC_BENCH_ACODER_HOST_VERSION}" ]; then',
    '    PROC_BENCH_ACODER_HOST_VERSION="latest"',
    '  fi',
    '  export PROC_BENCH_ACODER_HOST_VERSION',
    'fi',
  ];
}

function renderAndroidBenchAcoderModelModule(): string {
  return `#!/usr/bin/env python3
import os
import subprocess
import time
from dataclasses import dataclass, asdict, field
from typing import Any


def _env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def _normalize_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                if item.get("type") == "text":
                    parts.append(str(item.get("text", "")))
                elif item.get("type") == "image_url":
                    parts.append("[image_url omitted]")
                else:
                    parts.append(str(item))
            else:
                parts.append(str(item))
        return "\\n".join(part for part in parts if part)
    return str(content)


def _build_prompt(messages: list[dict[str, Any]]) -> str:
    lines = [
        "You are the model backend for an external benchmark harness.",
        "Do not use your own tools, do not inspect the local filesystem, and do not execute shell commands.",
        "Return only the next assistant message for the conversation below.",
        "",
    ]
    for message in messages:
        role = str(message.get("role", "user")).upper()
        content = _normalize_content(message.get("content", ""))
        lines.append(f"[{role}]")
        lines.append(content)
        lines.append("")
    lines.append("[ASSISTANT]")
    return "\\n".join(lines).strip()


def _build_acoder_command(prompt: str, model_name: str) -> list[str]:
    acoder_bin = os.getenv("ACODER_BIN", "acoder")
    agent = os.getenv("PROC_BENCH_ACODER_AGENT", "codex")
    args = [acoder_bin, "--agent", agent, "--model", model_name]
    if _env_flag("PROC_BENCH_ACODER_YOLO", True):
        args.append("--yolo")
    if _env_flag("PROC_BENCH_ACODER_DEBUG", False):
        args.append("--debug")
    if _env_flag("PROC_BENCH_ACODER_NO_BANNER", True):
        args.append("--no-banner")
    if _env_flag("PROC_BENCH_ACODER_NO_UPGRADE", True):
        args.append("--no-upgrade")

    if agent == "codex":
        args.extend(["--", "exec", "--sandbox", "danger-full-access", "--skip-git-repo-check", "--", prompt])
    elif agent == "claude":
        args.extend(["--", "--print", "--dangerously-skip-permissions", prompt])
    elif agent == "opencode":
        args.extend(["--", "run", prompt])
    elif agent == "qoder":
        args.extend(["--", "-p", prompt, "-f", "text", "--yolo"])
    else:
        raise ValueError(f"Unsupported acoder agent: {agent}")

    return args


def _trust_response_input() -> str:
    return f"{os.getenv('PROC_BENCH_ACODER_TRUST_RESPONSE', '1')}\\n"


@dataclass
class AcoderMiniSweAgentConfig:
    model_name: str
    model_kwargs: dict[str, Any] = field(default_factory=dict)


class AcoderMiniSweAgentModel:
    def __init__(self, **kwargs):
        self.config = AcoderMiniSweAgentConfig(**kwargs)
        self.cost = 0.0
        self.n_calls = 0

    def query(self, messages: list[dict[str, Any]], **kwargs) -> dict[str, Any]:
        prompt = _build_prompt(messages)
        command = _build_acoder_command(prompt, self.config.model_name)
        timeout_sec = int(os.getenv("PROC_BENCH_ACODER_TIMEOUT_SEC", "1800"))
        started = time.perf_counter()
        result = subprocess.run(
            command,
            cwd=os.getcwd(),
            env=os.environ.copy(),
            capture_output=True,
            text=True,
            input=_trust_response_input(),
            timeout=timeout_sec,
        )
        finished = time.perf_counter()
        self.n_calls += 1
        output = (result.stdout or "").strip()
        if result.returncode != 0:
            raise RuntimeError(
                f"acoder command failed with exit code {result.returncode}: {(result.stderr or '').strip()}"
            )
        return {
            "content": output,
            "extra": {
                "stdout": result.stdout,
                "stderr": result.stderr,
                "duration_seconds": finished - started,
            },
        }

    def get_template_vars(self) -> dict[str, Any]:
        return asdict(self.config) | {"n_model_calls": self.n_calls, "model_cost": self.cost}
`;
}

function renderTerminalBenchAcoderAgentModule(): string {
  return `import os
import shlex
import tempfile
from pathlib import Path

from terminal_bench.agents.base_agent import AgentResult
from terminal_bench.agents.failure_mode import FailureMode
from terminal_bench.agents.installed_agents.abstract_installed_agent import (
    AbstractInstalledAgent,
)
from terminal_bench.terminal.models import TerminalCommand


def _bool_like(value, default=False):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).lower() in {"1", "true", "yes", "on"}


class AcoderTerminalBenchAgent(AbstractInstalledAgent):
    @staticmethod
    def name() -> str:
        return "acoder-terminal-bench"

    def __init__(
        self,
        model_name: str,
        delegate_agent: str = "codex",
        acoder_bin: str = "acoder",
        acoder_version: str = "latest",
        acoder_yolo: bool = True,
        acoder_debug: bool = False,
        acoder_no_banner: bool = True,
        acoder_no_upgrade: bool = True,
        *args,
        **kwargs,
    ):
        super().__init__(*args, **kwargs)
        self._model_name = model_name
        self._delegate_agent = delegate_agent
        self._acoder_bin = acoder_bin
        self._acoder_version = acoder_version
        self._acoder_yolo = _bool_like(acoder_yolo, True)
        self._acoder_debug = _bool_like(acoder_debug, False)
        self._acoder_no_banner = _bool_like(acoder_no_banner, True)
        self._acoder_no_upgrade = _bool_like(acoder_no_upgrade, True)

    @property
    def _env(self) -> dict[str, str]:
        env = {}
        for key in [
            "OPENAI_API_KEY",
            "OPENAI_BASE_URL",
            "OPENAI_MODEL",
            "LLM_API_KEY",
            "LLM_BASE_URL",
            "LLM_MODEL",
            "ANTHROPIC_API_KEY",
            "ANTHROPIC_MODEL",
        ]:
            value = os.environ.get(key)
            if value:
                env[key] = value
        env["PROC_BENCH_ACODER_DELEGATE_AGENT"] = self._delegate_agent
        env["PROC_BENCH_ACODER_TRUST_RESPONSE"] = os.environ.get(
            "PROC_BENCH_ACODER_TRUST_RESPONSE", "1"
        )
        return env

    @property
    def _install_agent_script_path(self) -> Path:
        install_script = """#!/bin/bash
set -euo pipefail

apt-get update
apt-get install -y curl
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash
source "$HOME/.nvm/nvm.sh"
nvm install 22
npm -v
npm install -g @ali/acoder-cli@\${ACODER_VERSION}

case "\${PROC_BENCH_ACODER_DELEGATE_AGENT}" in
  codex)
    npm install -g @openai/codex
    ;;
  claude)
    npm install -g @anthropic-ai/claude-code
    ;;
  opencode)
    npm install -g opencode-ai
    ;;
  qoder)
    npm install -g @qoder-ai/qodercli
    ;;
esac
"""
        tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".sh", delete=False)
        tmp.write(install_script.replace("\${ACODER_VERSION}", self._acoder_version))
        tmp.close()
        os.chmod(tmp.name, 0o755)
        return Path(tmp.name)

    def _run_agent_commands(self, instruction: str) -> list[TerminalCommand]:
        args = [self._acoder_bin, "--agent", self._delegate_agent, "--model", self._model_name]
        if self._acoder_yolo:
            args.append("--yolo")
        if self._acoder_debug:
            args.append("--debug")
        if self._acoder_no_banner:
            args.append("--no-banner")
        if self._acoder_no_upgrade:
            args.append("--no-upgrade")

        if self._delegate_agent == "codex":
            args.extend(["--", "exec", "--sandbox", "danger-full-access", "--skip-git-repo-check", "--", instruction])
        elif self._delegate_agent == "claude":
            args.extend(["--", "--print", "--dangerously-skip-permissions", instruction])
        elif self._delegate_agent == "opencode":
            args.extend(["--", "run", instruction])
        elif self._delegate_agent == "qoder":
            args.extend(["--", "-p", instruction, "-f", "text", "--yolo"])
        else:
            raise ValueError(f"Unsupported acoder delegate agent: {self._delegate_agent}")

        shell_command = (
            "printf '%s\\\\n' \"$PROC_BENCH_ACODER_TRUST_RESPONSE\" | "
            + " ".join(shlex.quote(part) for part in args)
        )

        return [
            TerminalCommand(
                command=shell_command,
                min_timeout_sec=0.0,
                max_timeout_sec=float("inf"),
                block=True,
                append_enter=True,
            )
        ]
`;
}

function renderSweBenchAcoderRunner(): string {
  return `#!/usr/bin/env python3
import argparse
import json
import os
import pty
import re
import select
import shutil
import subprocess
import sys
import time
from pathlib import Path


def env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def normalize_prompt_text(value: str) -> str:
    return value.replace("\\r\\n", "\\n").replace("\\r", "\\n").replace("\\x00", " ")


def build_prompt(metadata: dict) -> str:
    return normalize_prompt_text(str(metadata.get("problem_statement", "")).strip())


def build_command(acoder_bin: str, prompt: str) -> list[str]:
    args = [acoder_bin]
    if env_flag("PROC_BENCH_ACODER_YOLO", True):
        args.append("-y")
    if env_flag("PROC_BENCH_ACODER_DEBUG", False):
        args.append("--debug")
    args.extend(["--", prompt])
    return args


def describe_command(acoder_bin: str) -> str:
    parts = [acoder_bin]
    if env_flag("PROC_BENCH_ACODER_YOLO", True):
        parts.append("-y")
    if env_flag("PROC_BENCH_ACODER_DEBUG", False):
        parts.append("--debug")
    parts.extend(["--", "<prompt.txt>"])
    return " ".join(parts)


def trust_response_input() -> str:
    return f"{os.getenv('PROC_BENCH_ACODER_TRUST_RESPONSE', '1')}\\n"


def trust_response_bytes() -> bytes:
    return trust_response_input().replace("\\n", "\\r").encode("utf-8")


def trust_response_attempt_bytes(attempt: int) -> bytes:
    if attempt <= 0:
        return trust_response_bytes() + b"\\r"
    return b"\\r"


def strip_terminal_control_sequences(buffer: bytes) -> bytes:
    buffer = re.sub(rb"\\x1b\\][^\\x07]*(?:\\x07|\\x1b\\\\)", b" ", buffer)
    buffer = re.sub(rb"\\x1b\\[[0-?]*[ -/]*[@-~]", b" ", buffer)
    buffer = re.sub(rb"\\x1b[@-Z\\\\-_]", b" ", buffer)
    buffer = buffer.replace(b"\\r", b"\\n")
    return re.sub(rb"\\s+", b" ", buffer)


def normalized_terminal_text(buffer: bytes) -> str:
    cleaned = strip_terminal_control_sequences(buffer)
    return re.sub(r"\\s+", " ", cleaned.decode("utf-8", errors="ignore")).strip().lower()


STATUS_NOISE_PATTERNS = (
    r"\\bworking\\b",
    r"\\bwait(?:ing)? for background terminal\\b",
    r"\\bimplement \\{feature\\}\\b",
    r"\\besc to interrupt\\b",
    r"\\bopenai codex\\b",
    r"\\bbooting mcp server\\b",
    r"\\btip:.*",
    r"\\bdefault\\b",
    r"\\bnull\\b",
    r"\\bctrl \\+ t to view transcript\\b",
)


COMPLETION_HINT_PATTERNS = (
    r"\\b\\d+\\s+passed\\b",
    r"\\b\\d+\\s+failed\\b",
    r"\\b\\d+\\s+error(?:s)?\\b",
    r"\\ball tests passed\\b",
)


def remove_terminal_status_noise(text: str) -> str:
    cleaned = text
    for pattern in STATUS_NOISE_PATTERNS:
        cleaned = re.sub(pattern, " ", cleaned)
    cleaned = re.sub(r"\\b\\d+[smh]?\\b", " ", cleaned)
    cleaned = re.sub(r"\\b[a-z]\\b", " ", cleaned)
    return re.sub(r"\\s+", " ", cleaned).strip()


def has_substantive_terminal_output(chunk: bytes) -> bool:
    text = normalized_terminal_text(chunk)
    if not text:
        return False
    return len(remove_terminal_status_noise(text)) >= 24


def buffer_has_completion_hint(buffer: bytes) -> bool:
    text = normalized_terminal_text(buffer)
    return any(re.search(pattern, text) for pattern in COMPLETION_HINT_PATTERNS)


def should_auto_confirm_trust_prompt(buffer: bytes) -> bool:
    lowered = strip_terminal_control_sequences(buffer).lower()
    is_claude_prompt = (
        b"accessing" in lowered
        and b"workspace" in lowered
        and (b"quick" in lowered or b"trust" in lowered or b"enter" in lowered)
    )
    is_codex_prompt = (
        b"do you trust the contents of this directory" in lowered
        or (
            b"yes, continue" in lowered
            and b"press enter to continue" in lowered
            and b"directory" in lowered
        )
    )
    return is_claude_prompt or is_codex_prompt


def acoder_cli_config_path() -> Path:
    return Path.home() / ".config" / "acoder-cli" / "config.json"


def read_json_file(path: Path) -> dict:
    return json.loads(path.read_text()) if path.exists() else {}


def sync_acoder_cli_config(agent: str, model: str) -> dict:
    path = acoder_cli_config_path()
    original_exists = path.exists()
    original_text = path.read_text() if original_exists else ""
    config = read_json_file(path)
    current_models = dict(config.get("currentModels") or {})
    current_models[agent] = model
    config["updatedAt"] = time.strftime("%Y-%m-%d %H:%M:%S")
    config["currentProvider"] = agent
    config["currentModels"] = current_models
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, indent=2, ensure_ascii=False))
    return {
        "path": str(path),
        "original_exists": original_exists,
        "original_text": original_text,
        "configured_provider": agent,
        "configured_model": model,
    }


def restore_acoder_cli_config(snapshot: dict) -> None:
    path = Path(snapshot["path"])
    if snapshot.get("original_exists"):
        path.write_text(str(snapshot.get("original_text", "")))
        return
    if path.exists():
        path.unlink()


def workspace_slug(workspace_dir: Path) -> str:
    return str(workspace_dir.resolve()).replace(os.sep, "-")


def git_status_porcelain(repo_path: Path) -> list[str]:
    result = subprocess.run(
        ["git", "-C", str(repo_path), "status", "--porcelain"],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"failed to read git status for {repo_path}: {result.stderr.strip()}"
        )
    return [line for line in result.stdout.splitlines() if line.strip()]


def git_diff_binary(repo_path: Path) -> bytes:
    result = subprocess.run(
        ["git", "-C", str(repo_path), "diff", "--binary"],
        check=False,
        capture_output=True,
    )
    return result.stdout or b""


def git_stash_push(repo_path: Path, message: str) -> str:
    result = subprocess.run(
        [
            "git",
            "-C",
            str(repo_path),
            "stash",
            "push",
            "--include-untracked",
            "-m",
            message,
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"failed to stash changes for {repo_path}: {result.stderr.strip()}"
        )
    return "stash@{0}"


def candidate_jsonl_paths(agent: str, workspace_dir: Path, delegate_env: dict | None = None) -> list[Path]:
    home = Path.home()
    env = delegate_env or os.environ
    if agent == "codex":
        codex_home = Path(env.get("CODEX_HOME", str(home / ".codex")))
        return sorted(path for path in codex_home.rglob("*.jsonl") if path.is_file())
    if agent == "claude":
        project_dir = home / ".claude" / "projects" / workspace_slug(workspace_dir)
        paths = list(project_dir.glob("*.jsonl")) if project_dir.exists() else []
        subagents_dir = project_dir / "subagents"
        if subagents_dir.exists():
            paths.extend(subagents_dir.glob("*.jsonl"))
        return sorted(paths)
    if agent == "qoder":
        project_dir = home / ".qoder" / "projects" / workspace_slug(workspace_dir)
        return sorted(project_dir.glob("*.jsonl")) if project_dir.exists() else []
    if agent == "opencode":
        prompt_history = home / ".local" / "state" / "opencode" / "prompt-history.jsonl"
        return [prompt_history] if prompt_history.exists() else []
    return []


def build_delegate_env(base_env: dict[str, str], run_dir: Path, agent: str) -> dict[str, str]:
    env = dict(base_env)
    if agent == "codex":
        codex_home = run_dir / ".codex-home"
        codex_home.mkdir(parents=True, exist_ok=True)
        env["CODEX_HOME"] = str(codex_home)
    return env


def load_existing_record(record_path: Path) -> dict | None:
    if not record_path.exists():
        return None
    try:
        data = json.loads(record_path.read_text())
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def snapshot_jsonl(paths: list[Path]) -> dict[str, tuple[int, int]]:
    snapshot = {}
    for path in paths:
        try:
            stat = path.stat()
        except FileNotFoundError:
            continue
        snapshot[str(path)] = (stat.st_mtime_ns, stat.st_size)
    return snapshot


def copy_matching_jsonl(before: dict[str, tuple[int, int]], after_paths: list[Path], destination_dir: Path) -> list[str]:
    destination_dir.mkdir(parents=True, exist_ok=True)
    copied = []
    used_names = set()
    for source_path in sorted(after_paths):
        try:
            stat = source_path.stat()
        except FileNotFoundError:
            continue
        current = (stat.st_mtime_ns, stat.st_size)
        previous = before.get(str(source_path))
        if previous == current:
            continue

        target_name = source_path.name
        if target_name in used_names:
            target_name = f"{len(used_names)}-{target_name}"
        used_names.add(target_name)
        target_path = destination_dir / target_name
        shutil.copy2(source_path, target_path)
        copied.append(str(target_path))
    return copied


def newest_rollout_jsonl(delegate_env: dict[str, str]) -> Path | None:
    codex_home = Path(delegate_env.get("CODEX_HOME", ""))
    if not codex_home.exists():
        return None
    candidates = sorted(
        (path for path in codex_home.rglob("rollout-*.jsonl") if path.is_file()),
        key=lambda path: path.stat().st_mtime_ns,
    )
    return candidates[-1] if candidates else None


def rollout_has_task_complete(rollout_path: Path) -> bool:
    try:
        size = rollout_path.stat().st_size
        with rollout_path.open("rb") as handle:
            if size > 262144:
                handle.seek(size - 262144)
            tail = handle.read().decode("utf-8", errors="ignore")
    except OSError:
        return False

    for line in reversed(tail.splitlines()):
        if '"type":"task_complete"' in line or '"type": "task_complete"' in line:
            return True
    return False


def emit_stream_note(stdout_file, message: str) -> None:
    note = f"\\n[procbench] {message}\\n".encode("utf-8")
    stdout_file.write(note)
    stdout_file.flush()
    sys.stdout.buffer.write(note)
    sys.stdout.buffer.flush()


def stop_process(process: subprocess.Popen[bytes], stdout_file, reason: str) -> int:
    if process.poll() is not None:
        return process.wait()
    try:
        process.terminate()
        emit_stream_note(stdout_file, f"{reason}; sent SIGTERM")
        return process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        emit_stream_note(stdout_file, f"{reason}; sent SIGKILL")
        return process.wait()


def run_and_stream(command: list[str], cwd: Path, env: dict[str, str], stdout_path: Path, stderr_path: Path, timeout_sec: int) -> dict[str, object]:
    with stdout_path.open("wb") as stdout_file, stderr_path.open("wb") as stderr_file:
        master_fd, slave_fd = pty.openpty()
        process = subprocess.Popen(
            command,
            cwd=str(cwd),
            env=env,
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            text=False,
            close_fds=True,
        )
        os.close(slave_fd)

        start = time.time()
        last_output_at = start
        last_substantive_output_at = start
        buffer = b""
        idle_exit_actions = [
            (b"\\x04", "sent Ctrl-D to request acoder exit"),
            (b"/exit\\r", "sent /exit to request acoder exit"),
            (b"exit\\r", "sent exit to request acoder exit"),
            (b"\\x03", "sent Ctrl-C to request acoder exit"),
        ]
        idle_exit_events: list[str] = []
        idle_exit_sec = int(os.getenv("PROC_BENCH_ACODER_IDLE_EXIT_SEC", "20"))
        task_complete_idle_exit_sec = int(
            os.getenv("PROC_BENCH_ACODER_TASK_COMPLETE_IDLE_EXIT_SEC", "5")
        )
        trust_attempts = 0
        last_trust_attempt_at = 0.0
        completion_hint_seen = False
        task_complete_seen = False
        task_complete_rollout_path: str | None = None
        last_rollout_check_at = 0.0
        timed_out = False
        exit_code = 1

        try:
            while True:
                if time.time() - start > timeout_sec:
                    timed_out = True
                    exit_code = stop_process(
                        process,
                        stdout_file,
                        f"wall-clock timeout after {timeout_sec}s",
                    )
                    break

                ready, _, _ = select.select([master_fd], [], [], 0.2)
                if master_fd in ready:
                    try:
                        chunk = os.read(master_fd, 4096)
                    except OSError:
                        chunk = b""

                    if chunk:
                        stdout_file.write(chunk)
                        stdout_file.flush()
                        sys.stdout.buffer.write(chunk)
                        sys.stdout.buffer.flush()
                        last_output_at = time.time()
                        buffer = (buffer + chunk)[-32768:]
                        if has_substantive_terminal_output(chunk):
                            last_substantive_output_at = time.time()
                        if not completion_hint_seen and buffer_has_completion_hint(buffer[-16384:]):
                            completion_hint_seen = True
                            emit_stream_note(
                                stdout_file,
                                "detected completion hint in acoder output; idle-exit is now armed",
                            )
                    elif process.poll() is not None:
                        break

                if (
                    process.poll() is None
                    and not task_complete_seen
                    and time.time() - last_rollout_check_at >= 1.0
                ):
                    last_rollout_check_at = time.time()
                    rollout_path = newest_rollout_jsonl(env)
                    if rollout_path and rollout_has_task_complete(rollout_path):
                        task_complete_seen = True
                        task_complete_rollout_path = str(rollout_path)
                        emit_stream_note(
                            stdout_file,
                            f"detected task_complete in {rollout_path.name}; idle-exit is now armed",
                        )

                if (
                    trust_attempts < 6
                    and should_auto_confirm_trust_prompt(buffer[-8192:])
                    and time.time() - last_trust_attempt_at >= 0.8
                ):
                    try:
                        payload = trust_response_attempt_bytes(trust_attempts)
                        os.write(master_fd, payload)
                        trust_attempts += 1
                        last_trust_attempt_at = time.time()
                        emit_stream_note(
                            stdout_file,
                            f"sent acoder trust confirmation attempt {trust_attempts}",
                        )
                    except OSError:
                        pass

                if (
                    process.poll() is None
                    and (completion_hint_seen or task_complete_seen)
                    and (
                        (
                            task_complete_seen
                            and task_complete_idle_exit_sec > 0
                        )
                        or (
                            not task_complete_seen
                            and idle_exit_sec > 0
                        )
                    )
                    and idle_exit_actions
                    and time.time() - last_substantive_output_at
                    >= (
                        task_complete_idle_exit_sec
                        if task_complete_seen
                        else idle_exit_sec
                    )
                ):
                    payload, label = idle_exit_actions.pop(0)
                    try:
                        os.write(master_fd, payload)
                        idle_exit_events.append(label)
                        emit_stream_note(stdout_file, label)
                        last_substantive_output_at = time.time()
                    except OSError:
                        pass

                if process.poll() is not None and master_fd not in ready:
                    break
        finally:
            try:
                os.close(master_fd)
            except OSError:
                pass

        stderr_file.write(b"")
        stderr_file.flush()
        if process.poll() is None:
            exit_code = stop_process(process, stdout_file, "runner finished while acoder was still alive")
        else:
            exit_code = process.wait()
        return {
            "exit_code": exit_code,
            "timed_out": timed_out,
            "idle_exit_events": idle_exit_events,
            "task_complete_rollout_path": task_complete_rollout_path,
        }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--projects-root", required=True)
    parser.add_argument("--questions-path", required=True)
    parser.add_argument("--experiments-root", required=False, default="")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--instance-id", action="append", default=[])
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    projects_root = Path(args.projects_root)
    questions_path = Path(args.questions_path)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    selected = set(args.instance_id or [])
    timeout_sec = int(os.getenv("PROC_BENCH_ACODER_TIMEOUT_SEC", "1800"))
    acoder_bin = os.getenv("ACODER_BIN", "acoder")
    acoder_agent = os.getenv("PROC_BENCH_ACODER_AGENT", "codex").strip() or "codex"
    acoder_model = (
        os.getenv("PROC_BENCH_MODEL", "").strip()
        or os.getenv("OPENAI_MODEL", "").strip()
        or os.getenv("LLM_MODEL", "").strip()
    )

    questions = json.loads(questions_path.read_text())
    if not isinstance(questions, list):
        raise ValueError("questions_path must point to a JSON array")

    print(
        f"[swe-runner] loaded {len(questions)} questions from {questions_path}",
        flush=True,
    )
    print(
        f"[swe-runner] projects root: {projects_root}",
        flush=True,
    )
    print(
        f"[swe-runner] output dir: {output_dir}",
        flush=True,
    )
    acoder_config_snapshot = {}
    if acoder_model:
        acoder_config_snapshot = sync_acoder_cli_config(acoder_agent, acoder_model)
        print(
            f"[swe-runner] configured acoder currentProvider={acoder_agent} model={acoder_model}",
            flush=True,
        )

    records = []
    missing_projects = []
    skipped_existing = 0
    try:
        for index, question in enumerate(questions, start=1):
            if not isinstance(question, dict):
                continue
            instance_id = str(question.get("instance_id", "")).strip()
            if not instance_id:
                continue
            if selected and instance_id not in selected:
                continue
            if args.limit and len(records) >= args.limit:
                break

            project_dir = projects_root / instance_id
            if not project_dir.is_dir():
                missing_projects.append(instance_id)
                print(
                    f"[swe-runner] missing project directory for {instance_id}",
                    flush=True,
                )
                continue

            metadata_path = project_dir / "metadata.json"
            metadata = question.copy()
            if metadata_path.exists():
                try:
                    metadata.update(json.loads(metadata_path.read_text()))
                except Exception:
                    pass

            run_dir = output_dir / instance_id
            run_dir.mkdir(parents=True, exist_ok=True)
            record_path = run_dir / "record.json"
            if record_path.exists() and not env_flag("PROC_BENCH_RERUN_EXISTING", False):
                existing_record = load_existing_record(record_path) or {}
                existing_record.setdefault("instance_id", instance_id)
                existing_record.setdefault("repo", metadata.get("repo"))
                existing_record.setdefault("base_commit", metadata.get("base_commit"))
                existing_record.setdefault("project_dir", str(project_dir))
                if not existing_record.get("skipped_reason"):
                    existing_record["skipped_reason"] = "existing run record present"
                records.append(existing_record)
                skipped_existing += 1
                print(
                    f"[swe-runner] skipping {instance_id}: existing run record found at {record_path}",
                    flush=True,
                )
                print(json.dumps(existing_record), flush=True)
                continue

            prompt = build_prompt(metadata)
            prompt_path = run_dir / "prompt.txt"
            prompt_path.write_text(prompt)

            stdout_path = run_dir / "acoder.stdout.txt"
            stderr_path = run_dir / "acoder.stderr.txt"
            result_patch_path = run_dir / "result_patch.diff"
            jsonl_dir = run_dir / "jsonl"
            delegate_env = build_delegate_env(os.environ.copy(), run_dir, acoder_agent)

            started = time.time()
            exit_code = 1
            copied_jsonl = []
            timed_out = False
            error_message = ""
            idle_exit_events = []
            task_complete_rollout_path = ""
            skipped_reason = ""
            preexisting_status = []
            preexisting_diff_path = run_dir / "preexisting.patch.diff"
            preexisting_stash_ref = ""
            preexisting_stash_message = ""
            before_jsonl = {}
            print(
                f"[swe-runner] ({index}/{len(questions)}) starting {instance_id}",
                flush=True,
            )
            print(
                f"[swe-runner] run dir: {run_dir}",
                flush=True,
            )
            print(
                f"[swe-runner] project dir: {project_dir}",
                flush=True,
            )
            try:
                preexisting_status = git_status_porcelain(project_dir)
                if preexisting_status:
                    preexisting_stash_message = f"procbench-preexisting-{instance_id}"
                    preexisting_diff_path.write_bytes(git_diff_binary(project_dir))
                    preexisting_stash_ref = git_stash_push(
                        project_dir, preexisting_stash_message
                    )
                    print(
                        f"[swe-runner] stashed preexisting changes for {instance_id} -> {preexisting_stash_ref}",
                        flush=True,
                    )
                command = build_command(acoder_bin, prompt)
                before_jsonl = snapshot_jsonl(candidate_jsonl_paths(acoder_agent, project_dir, delegate_env))
                if delegate_env.get("CODEX_HOME"):
                    print(
                        f"[swe-runner] isolated CODEX_HOME={delegate_env['CODEX_HOME']}",
                        flush=True,
                    )
                print(
                    "[swe-runner] command: " + describe_command(acoder_bin),
                    flush=True,
                )
                run_result = run_and_stream(
                    command=command,
                    cwd=project_dir,
                    env=delegate_env,
                    stdout_path=stdout_path,
                    stderr_path=stderr_path,
                    timeout_sec=timeout_sec,
                )
                exit_code = int(run_result.get("exit_code", 1))
                timed_out = bool(run_result.get("timed_out", False))
                idle_exit_events = list(run_result.get("idle_exit_events", []))
                task_complete_rollout_path = str(
                    run_result.get("task_complete_rollout_path", "") or ""
                )
                print(
                    f"[swe-runner] completed {instance_id} exit_code={exit_code} timed_out={timed_out}",
                    flush=True,
                )
            except Exception as exc:
                error_message = f"{type(exc).__name__}: {exc}"
                print(
                    f"[swe-runner] failed {instance_id}: {error_message}",
                    flush=True,
                )
            finally:
                after_jsonl = candidate_jsonl_paths(acoder_agent, project_dir, delegate_env)
                copied_jsonl = copy_matching_jsonl(before_jsonl, after_jsonl, jsonl_dir)
                result_patch_path.write_bytes(git_diff_binary(project_dir))
                print(
                    f"[swe-runner] finalized {instance_id} copied_jsonl={len(copied_jsonl)}",
                    flush=True,
                )

            record = {
                "instance_id": instance_id,
                "repo": metadata.get("repo"),
                "base_commit": metadata.get("base_commit"),
                "exit_code": exit_code,
                "timed_out": timed_out,
                "duration_seconds": time.time() - started,
                "project_dir": str(project_dir),
                "prompt_path": str(prompt_path),
                "stdout_path": str(stdout_path),
                "stderr_path": str(stderr_path),
                "result_patch_path": str(result_patch_path),
                "patch_path": str(result_patch_path),
                "preexisting_status": preexisting_status,
                "preexisting_diff_path": str(preexisting_diff_path) if preexisting_diff_path.exists() else "",
                "preexisting_stash_ref": preexisting_stash_ref,
                "preexisting_stash_message": preexisting_stash_message,
                "skipped_reason": skipped_reason,
                "error_message": error_message,
                "idle_exit_events": idle_exit_events,
                "task_complete_rollout_path": task_complete_rollout_path,
                "copied_jsonl": copied_jsonl,
            }
            record_path.write_text(json.dumps(record, indent=2))
            records.append(record)
            print(json.dumps(record), flush=True)

        summary_path = output_dir / "summary.json"
        summary_path.write_text(
            json.dumps(
                {
                    "questions_path": str(questions_path),
                    "projects_root": str(projects_root),
                    "total_questions": len(questions),
                    "executed": len(records),
                    "skipped_existing": skipped_existing,
                    "missing_projects": missing_projects,
                    "records": records,
                },
                indent=2,
            )
        )
        print(
            f"[swe-runner] finished executed={len(records)} skipped_existing={skipped_existing} missing_projects={len(missing_projects)} summary={summary_path}",
            flush=True,
        )
        return 0
    finally:
        if acoder_config_snapshot:
            restore_acoder_cli_config(acoder_config_snapshot)
            print("[swe-runner] restored acoder CLI config", flush=True)


if __name__ == "__main__":
    sys.exit(main())
`;
}

function validateConfig(config: BenchmarkRunConfig, configPath: string): void {
  if (!config.model.baseUrl) {
    throw new Error(`Missing model.base_url in ${configPath}`);
  }
  if (!config.model.apiKey) {
    throw new Error(`Missing model.api_key in ${configPath}`);
  }
  if (!config.model.model) {
    throw new Error(`Missing model.model in ${configPath}`);
  }
}

function parseConfigText(rawText: string): unknown {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return {};
  }
  if (trimmed.startsWith('{')) {
    return JSON.parse(rawText);
  }
  return parseSimpleYaml(rawText);
}

function parseSimpleYaml(rawText: string): Record<string, any> {
  const root: Record<string, any> = {};
  const stack: Array<{ indent: number; value: Record<string, any> }> = [
    { indent: -1, value: root },
  ];

  for (const rawLine of rawText.split(/\r?\n/)) {
    const cleanedLine = stripYamlComment(rawLine);
    if (!cleanedLine.trim()) {
      continue;
    }

    const indent = cleanedLine.length - cleanedLine.trimStart().length;
    const trimmedLine = cleanedLine.trim();
    const separatorIndex = trimmedLine.indexOf(':');
    if (separatorIndex <= 0) {
      throw new Error(`Invalid YAML line: ${rawLine}`);
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const rawValue = trimmedLine.slice(separatorIndex + 1).trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].value;
    if (!rawValue) {
      const nextValue: Record<string, any> = {};
      parent[key] = nextValue;
      stack.push({ indent, value: nextValue });
      continue;
    }

    parent[key] = parseYamlScalar(rawValue);
  }

  return root;
}

function parseYamlScalar(rawValue: string): string | number | boolean | null {
  const value = rawValue.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  if (value === 'null') {
    return null;
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}

function stripYamlComment(line: string): string {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (char === '#' && !inSingleQuote && !inDoubleQuote) {
      return line.slice(0, index);
    }
  }
  return line;
}

function resolveEnvPlaceholders(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)(:-([^}]*))?\}/gi, (_, variableName: string, _full, fallback: string) => {
    const envValue = process.env[variableName];
    if (typeof envValue === 'string' && envValue.length > 0) {
      return envValue;
    }
    return typeof fallback === 'string' ? fallback : '';
  });
}

function withProviderPrefix(model: string, prefix: string): string {
  if (!model || model.includes('/')) {
    return model;
  }
  return `${prefix}/${model}`;
}

function resolveTerminalBenchAgent(
  configuredAgent: TerminalBenchConfig['agent'],
  model: string
): 'openhands' | 'qwen-coder' {
  if (configuredAgent === 'openhands' || configuredAgent === 'qwen-coder') {
    return configuredAgent;
  }
  return looksLikeQwenModel(model) ? 'qwen-coder' : 'openhands';
}

function looksLikeQwenModel(model: string): boolean {
  return /(^|\/)qwen|qwen\d|qwen3-coder|coder-plus/i.test(model);
}

function looksLikeClaudeModel(model: string): boolean {
  return /(^|\/)claude|sonnet|opus|anthropic/i.test(model);
}

function looksLikeGptModel(model: string): boolean {
  return /(^|\/)gpt-|^o\d|openai/i.test(model);
}

function renderEnvScript(env: Record<string, string>): string {
  const lines = ['#!/usr/bin/env bash', 'set -euo pipefail', ''];
  for (const [key, value] of Object.entries(env)) {
    lines.push(`export ${key}=${shellQuote(value)}`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderShellScript(command: string): string {
  return ['#!/usr/bin/env bash', 'set -euo pipefail', '', command, ''].join('\n');
}

function renderBenchmarkLaunchScript(
  benchmarkRepoPath: string,
  runCommand: string,
  preflightLines: string[] = []
): string {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    'source "$SCRIPT_DIR/env.sh"',
    ...preflightLines,
    `cd ${shellQuote(benchmarkRepoPath)}`,
    runCommand,
    '',
  ].join('\n');
}

function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function escapeYamlDoubleQuoted(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function collectPathWarnings(entries: Array<{ label: string; filePath: string }>): string[] {
  const warnings: string[] = [];
  for (const entry of entries) {
    if (!entry.filePath) {
      warnings.push(`${entry.label} is empty.`);
      continue;
    }
    if (!fs.existsSync(entry.filePath)) {
      warnings.push(`${entry.label} does not exist: ${entry.filePath}`);
    }
  }
  return warnings;
}
