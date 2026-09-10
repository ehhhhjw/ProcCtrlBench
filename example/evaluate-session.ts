/**
 * 评估示例
 * 演示如何使用AgentEvaluator评估Claude Code session
 */

import { AgentEvaluator } from '../src/AgentEvaluator';
import * as path from 'path';
import * as fs from 'fs';

async function main() {
  // 从配置文件读取 jsonlPath
  const configPath = path.join(__dirname, '../config/project-analysis.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const jsonlPath = config.jsonlPath;

  console.log('=== Agent执行过程评估 ===\n');
  console.log(`JSONL文件: ${jsonlPath}\n`);

  try {
    // 创建评估器
    console.log('加载Session数据...');
    const evaluator = await AgentEvaluator.fromJsonlFile(jsonlPath);

    // 打印Session统计信息
    const stats = evaluator.getSessionStats();
    console.log('\nSession统计:');
    console.log(`  - 总消息数: ${stats.totalMessages}`);
    console.log(`  - 工具调用数: ${stats.totalToolUses}`);
    console.log(`  - Agent数: ${stats.totalAgents}`);
    console.log(`  - 总Tokens: ${stats.totalTokens}`);
    console.log(`  - 持续时间: ${stats.duration}秒\n`);

    // 执行评估
    console.log('开始评估...\n');
    const outputDir = path.join(__dirname, '../output/evaluation-reports');
    const report = await evaluator.evaluateAndSave(outputDir);

    // 打印摘要
    console.log('\n=== 评估结果摘要 ===\n');
    console.log(`总告警: ${report.summary.totalWarnings}`);
    console.log(`总错误: ${report.summary.totalErrors}`);

    console.log('\n关键问题:');
    report.summary.keyIssues.forEach((issue, i) => {
      console.log(`  ${i + 1}. ${issue}`);
    });

    if (report.summary.strengths.length > 0) {
      console.log('\n优势:');
      report.summary.strengths.forEach((strength, i) => {
        console.log(`  ${i + 1}. ${strength}`);
      });
    }

    console.log('\n各维度摘要:');
    console.log(`  - 任务结果: 完成率 ${(report.dimensions.taskOutcome.details.taskCompletionRate * 100).toFixed(0)}%, 可执行性 ${(report.dimensions.taskOutcome.details.outputExecutability * 100).toFixed(0)}%, 验证率 ${(report.dimensions.taskOutcome.details.postModificationVerificationRate * 100).toFixed(0)}%`);
    console.log(`  - 上下文管理: ${report.dimensions.contextManagement.warnings} 告警 / ${report.dimensions.contextManagement.errors} 错误`);
    console.log(`  - 工具使用效率: ${report.dimensions.toolUseEfficiency.warnings} 告警 / ${report.dimensions.toolUseEfficiency.errors} 错误`);
    console.log(`  - 工作流架构: ${report.dimensions.workflowArchitecture.warnings} 告警 / ${report.dimensions.workflowArchitecture.errors} 错误`);
    console.log(`  - 工具生态一致性: ${report.dimensions.toolEcosystemConsistency.warnings} 告警 / ${report.dimensions.toolEcosystemConsistency.errors} 错误`);
    if (report.analysis?.contextChains) {
      console.log(`  - 上下文链分析: ${report.analysis.contextChains.analyzedSteps} 步, 平均链长度 ${report.analysis.contextChains.averageChainLength.toFixed(2)}, 最大链长度 ${report.analysis.contextChains.maxChainLength}`);
      if (report.analysis.contextChains.outputPath) {
        console.log(`  - 每步上下文产物: ${report.analysis.contextChains.outputPath}`);
      }
      if (report.analysis.contextChains.contextChainMapPath) {
        console.log(`  - 上下文链映射: ${report.analysis.contextChains.contextChainMapPath}`);
      }
    }
    if (report.analysis?.standardEventStream) {
      console.log(`  - 标准事件流: ${report.analysis.standardEventStream.totalEvents} 事件, tool_call=${report.analysis.standardEventStream.toolCallEvents}, tool_result=${report.analysis.standardEventStream.toolResultEvents}`);
      if (report.analysis.standardEventStream.outputPath) {
        console.log(`  - 标准事件流产物: ${report.analysis.standardEventStream.outputPath}`);
      }
    }

    console.log(`\n报告已保存到: ${outputDir}`);
    console.log(`  - JSON: evaluation-${report.runId}.json`);
    console.log(`  - Markdown: evaluation-${report.runId}.md`);
    console.log(`  - Context Analysis: context-analysis-${report.runId}.json`);
    console.log(`  - Standard Event Stream: standard-event-stream-${report.runId}.json`);

  } catch (error) {
    console.error('评估失败:', error);
    process.exit(1);
  }
}

main();
