const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  normalizeGuardConfig,
} = require('../../dist/tools/claude-code-runtime-guard/src/config.js');
const {
  RuntimeGuardEngine,
} = require('../../dist/tools/claude-code-runtime-guard/src/guard-engine.js');

class FakeIssueSource {
  constructor() {
    this.lineCount = 100;
  }

  async analyzeSession(request) {
    this.lineCount += 1;
    return {
      transcriptPath: request.transcriptPath,
      sessionId: request.sessionId || 'fake-session',
      lineCount: this.lineCount,
      detectorErrors: [],
      issues: [
        { metric: 'ghostContext', severity: 'warning', message: 'ghost', deduction: 0.5 },
        { metric: 'oversizedRules', severity: 'warning', message: 'rules', deduction: 0.5 },
        { metric: 'thrashing', severity: 'error', message: 'thrash', deduction: 1.0 },
        { metric: 'toolCallChain', severity: 'error', message: 'tool chain', deduction: 1.0 },
        { metric: 'deadStep', severity: 'warning', message: 'dead', deduction: 0.5 },
        { metric: 'duplicateStep', severity: 'warning', message: 'dup', deduction: 0.5 },
        { metric: 'wrapperWorkflow', severity: 'warning', message: 'wrap', deduction: 0.5 },
        { metric: 'contextCoupling', severity: 'warning', message: 'coupling', deduction: 0.5 },
        { metric: 'longChain', severity: 'warning', message: 'long', deduction: 0.5 },
        { metric: 'inconsistentToolInterface', severity: 'warning', message: 'iface', deduction: 0.5 },
        { metric: 'weakTool', severity: 'warning', message: 'weak', deduction: 0.5 },
      ],
    };
  }
}

test('runtime guard engine emits all 11 benchmark alerts without hook filtering', async () => {
  const config = normalizeGuardConfig({
    runtime: {
      actions: {
        blockHighRiskPreToolUse: true,
      },
    },
  });
  const engine = new RuntimeGuardEngine(new FakeIssueSource());
  const result = await engine.analyze({ transcriptPath: '/tmp/fake.jsonl' }, config);

  assert.equal(result.alerts.length, 11);
  assert.equal(result.injections.length, 11);
  assert.equal(result.shouldBlock, true);
  assert.ok(result.blockReasons.some((reason) => reason.includes('contextThrashing')));
  assert.ok(result.blockReasons.some((reason) => reason.includes('toolCallChain')));
});

test('runtime guard engine honors cooldown suppression and benchmark toggles', async () => {
  const config = normalizeGuardConfig({
    benchmarks: {
      deadStep: {
        enabled: false,
      },
    },
  });
  const source = new FakeIssueSource();
  const engine = new RuntimeGuardEngine(source);

  const first = await engine.analyze({ transcriptPath: '/tmp/fake.jsonl' }, config);
  assert.equal(first.alerts.some((alert) => alert.benchmark === 'deadStep'), false);

  const second = await engine.analyze({ transcriptPath: '/tmp/fake.jsonl' }, config);
  assert.equal(second.alerts.length, 0);
});

test('runtime guard engine blocks only pre-tool high-risk alerts when enabled', async () => {
  const config = normalizeGuardConfig({
    runtime: {
      actions: {
        blockHighRiskPreToolUse: true,
      },
    },
  });
  const engine = new RuntimeGuardEngine(new FakeIssueSource());
  const result = await engine.analyze(
    { transcriptPath: '/tmp/fake.jsonl', hookEventName: 'PreToolUse' },
    config
  );

  assert.equal(result.shouldBlock, true);
  assert.ok(result.alerts.some((alert) => alert.benchmark === 'toolCallChain'));
  assert.ok(result.alerts.some((alert) => alert.benchmark === 'contextThrashing'));
  assert.equal(result.alerts.some((alert) => alert.benchmark === 'oversizedRules'), false);
});

test('runtime guard engine never treats write-like operations as dead step when special rule is enabled', async () => {
  class WriteDeadStepSource {
    async analyzeSession(request) {
      return {
        transcriptPath: request.transcriptPath,
        sessionId: 'write-session',
        lineCount: 10,
        detectorErrors: [],
        issues: [
          {
            metric: 'deadStep',
            severity: 'error',
            message: 'write dead step candidate',
            deduction: 1,
            evidence: {
              type: 'strong',
              details: {
                toolName: 'write_to_file',
              },
            },
          },
        ],
      };
    }
  }

  const config = normalizeGuardConfig();
  const engine = new RuntimeGuardEngine(new WriteDeadStepSource());
  const result = await engine.analyze({ transcriptPath: '/tmp/fake.jsonl' }, config);

  assert.equal(result.alerts.length, 0);
});

test('runtime guard engine blocks from report-level risk guidance and writes session state', async () => {
  class ReportOnlySource {
    async analyzeSession(request) {
      return {
        transcriptPath: request.transcriptPath,
        sessionId: 'report-session',
        lineCount: 12,
        detectorErrors: [],
        issues: [],
        report: {
          runId: 'report-session',
          timestamp: new Date().toISOString(),
          dimensions: {
            taskOutcome: {
              warnings: 0,
              errors: 0,
              details: {
                taskCompletionRate: 0.4,
                outputExecutability: 0.5,
                postModificationVerificationRate: 0.2,
              },
            },
            contextManagement: {
              warnings: 0,
              errors: 0,
              details: {
                ghostContext: { warnings: 0, errors: 0 },
                oversizedRules: { warnings: 0, errors: 0 },
                thrashing: { warnings: 0, errors: 0 },
              },
            },
            toolUseEfficiency: {
              warnings: 0,
              errors: 0,
              details: {
                toolCallChain: { warnings: 0, errors: 0 },
                deadStep: { warnings: 0, errors: 0 },
                duplicateStep: { warnings: 0, errors: 0 },
              },
            },
            workflowArchitecture: {
              warnings: 0,
              errors: 0,
              details: {
                wrapperWorkflow: { warnings: 0, errors: 0 },
                contextCoupling: { warnings: 0, errors: 0 },
                longChain: { warnings: 0, errors: 0 },
              },
            },
            toolEcosystemConsistency: {
              warnings: 0,
              errors: 0,
              details: {
                inconsistentToolInterface: { warnings: 0, errors: 0 },
                weakTool: { warnings: 0, errors: 0 },
              },
            },
          },
          diagnostics: [],
          findings: [],
          risk: {
            model: {
              kind: 'heuristic-bayesian-proxy',
              warningThreshold: 0.55,
              errorThreshold: 0.8,
            },
            calibration: {
              bucketCount: 10,
              sampleCount: 0,
              labelDefinition: 'detectorSeverity=error',
              meanPredictedRisk: 0,
              observedPositiveRate: 0,
              expectedCalibrationError: 0,
              maxCalibrationGap: 0,
              brierScore: 0,
              buckets: [],
            },
            overallRisk: 0.91,
            averagePosteriorRisk: 0.89,
            findingCount: 0,
            warningFindings: 0,
            errorFindings: 0,
            topRiskFindings: [],
            dimensions: {
              contextManagement: {
                warnings: 0,
                errors: 0,
                averageDetectorScore: 0,
                averagePosteriorRisk: 0.9,
                maxPosteriorRisk: 0.9,
              },
              toolUseEfficiency: {
                warnings: 0,
                errors: 0,
                averageDetectorScore: 0,
                averagePosteriorRisk: 0.92,
                maxPosteriorRisk: 0.92,
              },
              workflowArchitecture: {
                warnings: 0,
                errors: 0,
                averageDetectorScore: 0,
                averagePosteriorRisk: 0.88,
                maxPosteriorRisk: 0.88,
              },
              toolEcosystemConsistency: {
                warnings: 0,
                errors: 0,
                averageDetectorScore: 0,
                averagePosteriorRisk: 0.7,
                maxPosteriorRisk: 0.7,
              },
            },
          },
          controlPreservation: {
            score: 0.31,
            level: 'fragile',
            metrics: {
              interpretability: 0.3,
              interruptibility: 0.3,
              corrigibility: 0.3,
              reversibility: 0.3,
              handoffAwareness: 0.35,
            },
            evidence: ['control is fragile'],
          },
          executionGuidance: {
            autonomyLevel: 0.12,
            recommendedActions: [
              {
                type: 'request-confirmation',
                reason: 'overall risk is high and control is weak',
                triggeredBy: ['toolCallChain', 'longChain'],
              },
              {
                type: 'handoff',
                reason: 'escalate to supervised mode',
                triggeredBy: ['toolCallChain', 'longChain'],
              },
            ],
            rationale: ['overallRisk=0.91', 'controlPreservation=0.31'],
          },
          summary: {
            totalWarnings: 0,
            totalErrors: 0,
            keyIssues: [],
            strengths: [],
          },
        },
      };
    }
  }

  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-guard-state-'));
  const config = normalizeGuardConfig({
    runtime: {
      actions: {
        blockHighRiskPreToolUse: true,
      },
      sources: {
        sessionStateDir: stateDir,
      },
    },
  });
  const engine = new RuntimeGuardEngine(new ReportOnlySource());
  const result = await engine.analyze(
    { transcriptPath: '/tmp/fake.jsonl', hookEventName: 'PreToolUse' },
    config
  );

  assert.equal(result.shouldBlock, true);
  assert.ok(result.blockReasons.some((reason) => reason.includes('report:request-confirmation')));
  assert.ok(result.blockReasons.some((reason) => reason.includes('report:handoff')));
  assert.ok(result.injections.some((injection) => injection.benchmark === 'report'));
  assert.equal(typeof result.statePath, 'string');

  const savedState = JSON.parse(fs.readFileSync(result.statePath, 'utf-8'));
  assert.equal(savedState.sessionId, 'report-session');
  assert.equal(savedState.shouldBlock, true);
  assert.equal(savedState.risk.overallRisk, 0.91);
  assert.equal(savedState.controlPreservation.score, 0.31);
  assert.equal(savedState.executionGuidance.recommendedActions.length, 2);
});
