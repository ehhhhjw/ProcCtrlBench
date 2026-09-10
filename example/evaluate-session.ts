/**
 * Evaluation example
 * Demonstrates how to use AgentEvaluator to evaluate a Claude Code session
 */

import { AgentEvaluator } from '../src/AgentEvaluator';
import * as path from 'path';
import * as fs from 'fs';

async function main() {
  // Read jsonlPath from the config file
  const configPath = path.join(__dirname, '../config/project-analysis.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const jsonlPath = config.jsonlPath;

  console.log('=== Agent Execution Process Evaluation ===\n');
  console.log(`JSONL file: ${jsonlPath}\n`);

  try {
    // Create the evaluator
    console.log('Loading session data...');
    const evaluator = await AgentEvaluator.fromJsonlFile(jsonlPath);

    // Print session statistics
    const stats = evaluator.getSessionStats();
    console.log('\nSession statistics:');
    console.log(`  - Total messages: ${stats.totalMessages}`);
    console.log(`  - Tool calls: ${stats.totalToolUses}`);
    console.log(`  - Agents: ${stats.totalAgents}`);
    console.log(`  - Total tokens: ${stats.totalTokens}`);
    console.log(`  - Duration: ${stats.duration}s\n`);

    // Run the evaluation
    console.log('Starting evaluation...\n');
    const outputDir = path.join(__dirname, '../output/evaluation-reports');
    const report = await evaluator.evaluateAndSave(outputDir);

    // Print the summary
    console.log('\n=== Evaluation Result Summary ===\n');
    console.log(`Total warnings: ${report.summary.totalWarnings}`);
    console.log(`Total errors: ${report.summary.totalErrors}`);

    console.log('\nKey issues:');
    report.summary.keyIssues.forEach((issue, i) => {
      console.log(`  ${i + 1}. ${issue}`);
    });

    if (report.summary.strengths.length > 0) {
      console.log('\nStrengths:');
      report.summary.strengths.forEach((strength, i) => {
        console.log(`  ${i + 1}. ${strength}`);
      });
    }

    console.log('\nPer-dimension summary:');
    console.log(`  - Task outcome: completion rate ${(report.dimensions.taskOutcome.details.taskCompletionRate * 100).toFixed(0)}%, executability ${(report.dimensions.taskOutcome.details.outputExecutability * 100).toFixed(0)}%, verification rate ${(report.dimensions.taskOutcome.details.postModificationVerificationRate * 100).toFixed(0)}%`);
    console.log(`  - Context management: ${report.dimensions.contextManagement.warnings} warnings / ${report.dimensions.contextManagement.errors} errors`);
    console.log(`  - Tool use efficiency: ${report.dimensions.toolUseEfficiency.warnings} warnings / ${report.dimensions.toolUseEfficiency.errors} errors`);
    console.log(`  - Workflow architecture: ${report.dimensions.workflowArchitecture.warnings} warnings / ${report.dimensions.workflowArchitecture.errors} errors`);
    console.log(`  - Tool ecosystem consistency: ${report.dimensions.toolEcosystemConsistency.warnings} warnings / ${report.dimensions.toolEcosystemConsistency.errors} errors`);
    if (report.analysis?.contextChains) {
      console.log(`  - Context chain analysis: ${report.analysis.contextChains.analyzedSteps} steps, average chain length ${report.analysis.contextChains.averageChainLength.toFixed(2)}, max chain length ${report.analysis.contextChains.maxChainLength}`);
      if (report.analysis.contextChains.outputPath) {
        console.log(`  - Per-step context artifact: ${report.analysis.contextChains.outputPath}`);
      }
      if (report.analysis.contextChains.contextChainMapPath) {
        console.log(`  - Context chain map: ${report.analysis.contextChains.contextChainMapPath}`);
      }
    }
    if (report.analysis?.standardEventStream) {
      console.log(`  - Standard event stream: ${report.analysis.standardEventStream.totalEvents} events, tool_call=${report.analysis.standardEventStream.toolCallEvents}, tool_result=${report.analysis.standardEventStream.toolResultEvents}`);
      if (report.analysis.standardEventStream.outputPath) {
        console.log(`  - Standard event stream artifact: ${report.analysis.standardEventStream.outputPath}`);
      }
    }

    console.log(`\nReport saved to: ${outputDir}`);
    console.log(`  - JSON: evaluation-${report.runId}.json`);
    console.log(`  - Markdown: evaluation-${report.runId}.md`);
    console.log(`  - Context Analysis: context-analysis-${report.runId}.json`);
    console.log(`  - Standard Event Stream: standard-event-stream-${report.runId}.json`);

  } catch (error) {
    console.error('Evaluation failed:', error);
    process.exit(1);
  }
}

main();
