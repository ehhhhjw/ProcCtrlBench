import { EvaluationReport } from '../types/evaluation.types';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Report generator
 */
export class ReportGenerator {
  /**
   * Generate a JSON-format report
   */
  generateJSON(report: EvaluationReport): string {
    return JSON.stringify(report, null, 2);
  }

  /**
   * Generate a Markdown-format report
   */
  generateMarkdown(report: EvaluationReport): string {
    let md = `# Agent Execution Evaluation Report\n\n`;
    md += `**Run ID**: ${report.runId}\n`;
    md += `**Time**: ${report.timestamp}\n`;
    md += `**Evaluation approach**: non-scoring; reports diagnostics, process risk, control preservation and execution guidance\n\n`;

    // Overview
    md += `## Overview\n\n`;
    md += `- Total warnings: ${report.summary.totalWarnings}\n`;
    md += `- Total errors: ${report.summary.totalErrors}\n`;
    md += `- Diagnostic issues: ${report.diagnostics.length}\n\n`;

    md += `## Process Risk\n\n`;
    md += `- overallRisk: ${report.risk.overallRisk.toFixed(2)}\n`;
    md += `- averagePosteriorRisk: ${report.risk.averagePosteriorRisk.toFixed(2)}\n`;
    md += `- warning findings: ${report.risk.warningFindings}\n`;
    md += `- error findings: ${report.risk.errorFindings}\n`;
    md += `- Risk model: ${report.risk.model.kind}\n\n`;

    md += `## Control Preservation\n\n`;
    md += `- Overall score: ${report.controlPreservation.score.toFixed(2)} (${report.controlPreservation.level})\n`;
    md += `- Interpretability: ${report.controlPreservation.metrics.interpretability.toFixed(2)}\n`;
    md += `- Interruptibility: ${report.controlPreservation.metrics.interruptibility.toFixed(2)}\n`;
    md += `- Correctability: ${report.controlPreservation.metrics.corrigibility.toFixed(2)}\n`;
    md += `- Reversibility: ${report.controlPreservation.metrics.reversibility.toFixed(2)}\n`;
    md += `- Authority handoff: ${report.controlPreservation.metrics.handoffAwareness.toFixed(2)}\n\n`;

    md += `## Execution Guidance\n\n`;
    md += `- Autonomy adjustment coefficient: ${report.executionGuidance.autonomyLevel.toFixed(2)}\n`;
    report.executionGuidance.recommendedActions.forEach((action, index) => {
      const triggerText = action.triggeredBy.length > 0 ? ` [${action.triggeredBy.join(', ')}]` : '';
      md += `- Action ${index + 1}: ${action.type}${triggerText} - ${action.reason}\n`;
    });
    md += `\n`;

    if (report.analysis?.contextChains) {
      const contextAnalysis = report.analysis.contextChains;
      md += `## Context Chain Analysis\n\n`;
      md += `- Enabled: ${contextAnalysis.enabled ? 'yes' : 'no'}\n`;
      md += `- Analyzed steps: ${contextAnalysis.analyzedSteps}\n`;
      md += `- Average chain length: ${contextAnalysis.averageChainLength.toFixed(2)}\n`;
      md += `- Maximum chain length: ${contextAnalysis.maxChainLength}\n`;
      md += `- Average preceding context tokens: ${contextAnalysis.averageContextTokensBefore.toFixed(2)}\n`;
      md += `- Maximum preceding context tokens: ${contextAnalysis.maxContextTokensBefore}\n`;
      if (contextAnalysis.outputPath) {
        md += `- Per-step context artifact: ${contextAnalysis.outputPath}\n`;
      }
      if (contextAnalysis.contextChainMapPath) {
        md += `- Context chain map: ${contextAnalysis.contextChainMapPath}\n`;
      }
      md += `\n`;
    }

    if (report.analysis?.standardEventStream) {
      const eventStream = report.analysis.standardEventStream;
      md += `## Standard Event Stream\n\n`;
      md += `- Total events: ${eventStream.totalEvents}\n`;
      md += `- message events: ${eventStream.messageEvents}\n`;
      md += `- tool_call events: ${eventStream.toolCallEvents}\n`;
      md += `- tool_result events: ${eventStream.toolResultEvents}\n`;
      md += `- Compression-related events: ${eventStream.compressedEvents}\n`;
      if (eventStream.outputPath) {
        md += `- Event stream artifact: ${eventStream.outputPath}\n`;
      }
      md += `\n`;
    }

    // Per-dimension summary
    md += `## Dimension Summary\n\n`;
    md += `| Dimension | Warnings | Errors |\n`;
    md += `|------|------|------|\n`;
    md += `| Task Outcome | ${report.dimensions.taskOutcome.warnings} | ${report.dimensions.taskOutcome.errors} |\n`;
    md += `| Context Management | ${report.dimensions.contextManagement.warnings} | ${report.dimensions.contextManagement.errors} |\n`;
    md += `| Tool Use Efficiency | ${report.dimensions.toolUseEfficiency.warnings} | ${report.dimensions.toolUseEfficiency.errors} |\n`;
    md += `| Workflow Architecture | ${report.dimensions.workflowArchitecture.warnings} | ${report.dimensions.workflowArchitecture.errors} |\n`;
    md += `| Tool Ecosystem Consistency | ${report.dimensions.toolEcosystemConsistency.warnings} | ${report.dimensions.toolEcosystemConsistency.errors} |\n\n`;

    // Key issues
    if (report.summary.keyIssues.length > 0) {
      md += `## Key Issues\n\n`;
      report.summary.keyIssues.forEach((issue, i) => {
        md += `${i + 1}. ${issue}\n`;
      });
      md += `\n`;
    }

    // Strengths
    if (report.summary.strengths.length > 0) {
      md += `## Strengths\n\n`;
      report.summary.strengths.forEach((strength, i) => {
        md += `${i + 1}. ${strength}\n`;
      });
      md += `\n`;
    }

    if (report.findings.length > 0) {
      md += `## High-Risk Findings\n\n`;
      report.findings
        .slice()
        .sort((a, b) => b.posteriorRisk - a.posteriorRisk)
        .slice(0, 5)
        .forEach((finding, index) => {
          md += `${index + 1}. [${finding.dimension}] ${finding.metric} | score=${finding.detectorScore.toFixed(2)} | posterior=${finding.posteriorRisk.toFixed(2)} | risk=${finding.riskSeverity}\n`;
          md += `   - ${finding.message}\n`;
        });
      md += `\n`;
    }

    // Detailed diagnostics
    if (report.diagnostics.length > 0) {
      md += `## Detailed Diagnostics\n\n`;

      // Group by severity
      const errors = report.diagnostics.filter(d => d.severity === 'error');
      const warnings = report.diagnostics.filter(d => d.severity === 'warning');

      if (errors.length > 0) {
        md += `### Errors (${errors.length})\n\n`;
        errors.forEach((issue, i) => {
          md += this.formatIssue(issue, i + 1);
        });
      }

      if (warnings.length > 0) {
        md += `### Warnings (${warnings.length})\n\n`;
        warnings.forEach((issue, i) => {
          md += this.formatIssue(issue, i + 1);
        });
      }
    }

    // Dimension details
    md += `## Dimension Details\n\n`;
    md += this.formatDimensionDetails(report);

    return md;
  }

  /**
   * Format an issue
   */
  private formatIssue(issue: any, index: number): string {
    let md = `#### ${index}. ${issue.message}\n\n`;
    md += `- **Metric**: ${issue.metric}\n`;
    md += `- **Severity**: ${issue.severity}\n`;

    if (issue.location) {
      if (issue.location.stepRange) {
        md += `- **Location**: steps ${issue.location.stepRange[0]} - ${issue.location.stepRange[1]}\n`;
      }
      if (issue.location.messageUuid) {
        md += `- **Message UUID**: ${issue.location.messageUuid}\n`;
      }
    }

    if (issue.suggestion) {
      md += `- **Suggestion**: ${issue.suggestion}\n`;
    }

    md += `\n`;
    return md;
  }

  /**
   * Format dimension details
   */
  private formatDimensionDetails(report: EvaluationReport): string {
    let md = '';

    // Context management
    md += `### Context Management\n\n`;
    md += `- Ghost Context: ${report.dimensions.contextManagement.details.ghostContext.warnings} warnings, ${report.dimensions.contextManagement.details.ghostContext.errors} errors\n`;
    md += `- Oversized Rules: ${report.dimensions.contextManagement.details.oversizedRules.warnings} warnings, ${report.dimensions.contextManagement.details.oversizedRules.errors} errors\n`;
    md += `- Context Thrashing: ${report.dimensions.contextManagement.details.thrashing.warnings} warnings, ${report.dimensions.contextManagement.details.thrashing.errors} errors\n\n`;

    // Tool use efficiency
    md += `### Tool Use Efficiency\n\n`;
    md += `- Tool Call Chain: ${report.dimensions.toolUseEfficiency.details.toolCallChain.warnings} warnings, ${report.dimensions.toolUseEfficiency.details.toolCallChain.errors} errors\n`;
    md += `- Dead Step: ${report.dimensions.toolUseEfficiency.details.deadStep.warnings} warnings, ${report.dimensions.toolUseEfficiency.details.deadStep.errors} errors\n`;
    md += `- Duplicate Step: ${report.dimensions.toolUseEfficiency.details.duplicateStep.warnings} warnings, ${report.dimensions.toolUseEfficiency.details.duplicateStep.errors} errors\n\n`;

    // Workflow architecture
    md += `### Workflow Architecture\n\n`;
    md += `- Wrapper Workflow: ${report.dimensions.workflowArchitecture.details.wrapperWorkflow.warnings} warnings, ${report.dimensions.workflowArchitecture.details.wrapperWorkflow.errors} errors\n`;
    md += `- Context Coupling: ${report.dimensions.workflowArchitecture.details.contextCoupling.warnings} warnings, ${report.dimensions.workflowArchitecture.details.contextCoupling.errors} errors\n`;
    md += `- Long Chain: ${report.dimensions.workflowArchitecture.details.longChain.warnings} warnings, ${report.dimensions.workflowArchitecture.details.longChain.errors} errors\n\n`;

    // Tool ecosystem consistency
    md += `### Tool Ecosystem Consistency\n\n`;
    md += `- Inconsistent Tool Interface: ${report.dimensions.toolEcosystemConsistency.details.inconsistentToolInterface.warnings} warnings, ${report.dimensions.toolEcosystemConsistency.details.inconsistentToolInterface.errors} errors\n`;
    md += `- Weak Tool: ${report.dimensions.toolEcosystemConsistency.details.weakTool.warnings} warnings, ${report.dimensions.toolEcosystemConsistency.details.weakTool.errors} errors\n\n`;

    md += `### Risk Dimension Summary\n\n`;
    md += `- Context Management: avg posterior ${report.risk.dimensions.contextManagement.averagePosteriorRisk.toFixed(2)}, max posterior ${report.risk.dimensions.contextManagement.maxPosteriorRisk.toFixed(2)}\n`;
    md += `- Tool Use Efficiency: avg posterior ${report.risk.dimensions.toolUseEfficiency.averagePosteriorRisk.toFixed(2)}, max posterior ${report.risk.dimensions.toolUseEfficiency.maxPosteriorRisk.toFixed(2)}\n`;
    md += `- Workflow Architecture: avg posterior ${report.risk.dimensions.workflowArchitecture.averagePosteriorRisk.toFixed(2)}, max posterior ${report.risk.dimensions.workflowArchitecture.maxPosteriorRisk.toFixed(2)}\n`;
    md += `- Tool Ecosystem: avg posterior ${report.risk.dimensions.toolEcosystemConsistency.averagePosteriorRisk.toFixed(2)}, max posterior ${report.risk.dimensions.toolEcosystemConsistency.maxPosteriorRisk.toFixed(2)}\n\n`;

    return md;
  }

  /**
   * Save the report to disk
   */
  async saveReport(
    report: EvaluationReport,
    outputDir: string,
    formats: Array<'json' | 'markdown'> = ['json', 'markdown']
  ): Promise<void> {
    // Make sure the output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const baseFilename = `evaluation-${report.runId}`;

    // Save JSON
    if (formats.includes('json')) {
      const jsonPath = path.join(outputDir, `${baseFilename}.json`);
      fs.writeFileSync(jsonPath, this.generateJSON(report), 'utf-8');
    }

    // Save Markdown
    if (formats.includes('markdown')) {
      const mdPath = path.join(outputDir, `${baseFilename}.md`);
      fs.writeFileSync(mdPath, this.generateMarkdown(report), 'utf-8');

      // If a compare-summary exists, append it to the end of the report (improves readability)
      try {
        const comparePath = path.join(process.cwd(), 'output', 'benchmark', 'compare-summary.md');
        if (fs.existsSync(comparePath)) {
          const compare = fs.readFileSync(comparePath, 'utf-8');
          const section = `\n\n## Before/After Remediation Comparison\n\n${compare}\n`;
          fs.appendFileSync(mdPath, section, 'utf-8');
        }
      } catch (_) {
        // Ignore append failures; they must not affect the main flow
      }
    }
  }
}
