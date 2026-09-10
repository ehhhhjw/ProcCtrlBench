import * as fs from 'fs';
import * as path from 'path';
import {
  BENCHMARK_IDS,
  BenchmarkGuardSettings,
  BenchmarkId,
  GuardConfig,
} from './types';

function benchmarkDefaults(): Record<BenchmarkId, BenchmarkGuardSettings> {
  return {
    ghostContext: {
      enabled: true,
      mode: 'guard',
      cooldownSteps: 3,
      blockOnError: false,
      thresholds: {
        warningTokens: 512,
        errorTokens: 1024,
        lookAheadSteps: 5,
      },
    },
    oversizedRules: {
      enabled: true,
      mode: 'warn',
      cooldownSteps: 10,
      blockOnError: false,
      thresholds: {
        warningTokens: 2000,
        errorTokens: 4000,
        warningRatio: 0.2,
        errorRatio: 0.35,
      },
    },
    contextThrashing: {
      enabled: true,
      mode: 'guard',
      cooldownSteps: 2,
      blockOnError: true,
      thresholds: {
        windowThreshold: 0.75,
        compressionLookAhead: 2,
        largeReadTokenThreshold: 600,
      },
    },
    toolCallChain: {
      enabled: true,
      mode: 'guard',
      cooldownSteps: 2,
      blockOnError: true,
      thresholds: {
        repetitiveWarning: 6,
        repetitiveError: 10,
        cyclicWarning: 3,
        cyclicError: 5,
      },
    },
    deadStep: {
      enabled: true,
      mode: 'warn',
      cooldownSteps: 3,
      blockOnError: false,
      thresholds: {
        lookAheadSteps: 5,
        warningFailedChecks: 3,
        errorFailedChecks: 4,
      },
      specialRules: {
        writeNeverDeadStep: true,
      },
    },
    duplicateStep: {
      enabled: true,
      mode: 'guard',
      cooldownSteps: 2,
      blockOnError: false,
      thresholds: {
        inputSimilarity: 0.92,
        outputSimilarity: 0.9,
        symbolJaccard: 0.85,
      },
    },
    wrapperWorkflow: {
      enabled: true,
      mode: 'warn',
      cooldownSteps: 5,
      blockOnError: false,
      thresholds: {
        minAgentCalls: 5,
        maxInternalStepsForWrapper: 2,
        minSymbolDelta: 1,
      },
    },
    contextCoupling: {
      enabled: true,
      mode: 'warn',
      cooldownSteps: 4,
      blockOnError: false,
      thresholds: {
        sccSizeWarning: 3,
        alternationWarning: 4,
        backEdgeWarning: 2,
      },
    },
    longChain: {
      enabled: true,
      mode: 'guard',
      cooldownSteps: 4,
      blockOnError: false,
      thresholds: {
        effectiveWarning: 12,
        effectiveError: 20,
        simpleWarning: 25,
        simpleError: 40,
      },
    },
    inconsistentToolInterface: {
      enabled: true,
      mode: 'warn',
      cooldownSteps: 20,
      blockOnError: false,
      thresholds: {
        schemaDeltaWarning: 0.5,
        resultShapeDeltaWarning: 0.5,
        semanticOverlapWarning: 0.7,
      },
    },
    weakTool: {
      enabled: true,
      mode: 'remediate',
      cooldownSteps: 3,
      blockOnError: false,
      thresholds: {
        opportunityWindow: 3,
        minMissedOpportunities: 2,
      },
    },
  };
}

export const DEFAULT_GUARD_CONFIG: GuardConfig = {
  enabled: true,
  mode: 'guard',
  runtime: {
    analysisRootDir: process.cwd(),
    transport: {
      useHooks: true,
      useTranscriptTailing: true,
      watchSubagents: true,
    },
    sources: {
      projectAstPath: './output/project-ast.json',
      fileGraphPath: './output/file-graph.json',
      relatedFilesDataPath: '',
      calibrationProfilePath: '',
      sessionStateDir: './.cc-guard/state',
      alertOutputDir: './.cc-guard/alerts',
      remediationOutputDir: './.cc-guard/remediation',
    },
    actions: {
      emitStdout: true,
      emitStderr: true,
      writeAlertFiles: true,
      writeRemediationFiles: true,
      injectPromptSuggestions: true,
      blockHighRiskPreToolUse: false,
    },
  },
  benchmarks: benchmarkDefaults(),
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function mergeBenchmarkSettings(
  base: BenchmarkGuardSettings,
  override?: Partial<BenchmarkGuardSettings>
): BenchmarkGuardSettings {
  if (!override) {
    return clone(base);
  }

  return {
    ...clone(base),
    ...override,
    thresholds: {
      ...(base.thresholds || {}),
      ...((override.thresholds as Record<string, unknown>) || {}),
    },
    specialRules: {
      ...(base.specialRules || {}),
      ...((override.specialRules as Record<string, unknown>) || {}),
    },
  };
}

export function normalizeGuardConfig(input?: Partial<GuardConfig>): GuardConfig {
  const merged: GuardConfig = {
    ...clone(DEFAULT_GUARD_CONFIG),
    ...(input || {}),
    runtime: {
      ...clone(DEFAULT_GUARD_CONFIG.runtime),
      ...(input?.runtime || {}),
      transport: {
        ...clone(DEFAULT_GUARD_CONFIG.runtime.transport),
        ...(input?.runtime?.transport || {}),
      },
      sources: {
        ...clone(DEFAULT_GUARD_CONFIG.runtime.sources),
        ...(input?.runtime?.sources || {}),
      },
      actions: {
        ...clone(DEFAULT_GUARD_CONFIG.runtime.actions),
        ...(input?.runtime?.actions || {}),
      },
      analysisRootDir: path.resolve(
        input?.runtime?.analysisRootDir || DEFAULT_GUARD_CONFIG.runtime.analysisRootDir
      ),
    },
    benchmarks: benchmarkDefaults(),
  };

  for (const benchmark of BENCHMARK_IDS) {
    merged.benchmarks[benchmark] = mergeBenchmarkSettings(
      DEFAULT_GUARD_CONFIG.benchmarks[benchmark],
      input?.benchmarks?.[benchmark]
    );
  }

  return merged;
}

export function loadGuardConfig(configPath?: string): GuardConfig {
  if (!configPath) {
    return normalizeGuardConfig();
  }

  const resolved = path.resolve(configPath);
  const raw = fs.readFileSync(resolved, 'utf-8');
  const parsed = JSON.parse(raw) as Partial<GuardConfig>;
  return normalizeGuardConfig(parsed);
}
