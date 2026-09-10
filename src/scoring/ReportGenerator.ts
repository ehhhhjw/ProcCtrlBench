import { EvaluationReport } from '../types/evaluation.types';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 报告生成器
 */
export class ReportGenerator {
  /**
   * 生成JSON格式报告
   */
  generateJSON(report: EvaluationReport): string {
    return JSON.stringify(report, null, 2);
  }

  /**
   * 生成Markdown格式报告
   */
  generateMarkdown(report: EvaluationReport): string {
    let md = `# Agent执行评估报告\n\n`;
    md += `**Run ID**: ${report.runId}\n`;
    md += `**时间**: ${report.timestamp}\n`;
    md += `**评估方式**: 非评分制，输出诊断、过程风险、控制保持与执行引导\n\n`;

    // 概览
    md += `## 概览\n\n`;
    md += `- 总告警数: ${report.summary.totalWarnings}\n`;
    md += `- 总错误数: ${report.summary.totalErrors}\n`;
    md += `- 诊断问题数: ${report.diagnostics.length}\n\n`;

    md += `## 过程风险\n\n`;
    md += `- overallRisk: ${report.risk.overallRisk.toFixed(2)}\n`;
    md += `- averagePosteriorRisk: ${report.risk.averagePosteriorRisk.toFixed(2)}\n`;
    md += `- warning findings: ${report.risk.warningFindings}\n`;
    md += `- error findings: ${report.risk.errorFindings}\n`;
    md += `- 风险模型: ${report.risk.model.kind}\n\n`;

    md += `## 控制保持\n\n`;
    md += `- 总分: ${report.controlPreservation.score.toFixed(2)} (${report.controlPreservation.level})\n`;
    md += `- 可理解性: ${report.controlPreservation.metrics.interpretability.toFixed(2)}\n`;
    md += `- 可干预性: ${report.controlPreservation.metrics.interruptibility.toFixed(2)}\n`;
    md += `- 可修正性: ${report.controlPreservation.metrics.corrigibility.toFixed(2)}\n`;
    md += `- 可回退性: ${report.controlPreservation.metrics.reversibility.toFixed(2)}\n`;
    md += `- 判断权交还: ${report.controlPreservation.metrics.handoffAwareness.toFixed(2)}\n\n`;

    md += `## 执行引导\n\n`;
    md += `- 自治调节系数: ${report.executionGuidance.autonomyLevel.toFixed(2)}\n`;
    report.executionGuidance.recommendedActions.forEach((action, index) => {
      const triggerText = action.triggeredBy.length > 0 ? ` [${action.triggeredBy.join(', ')}]` : '';
      md += `- 动作 ${index + 1}: ${action.type}${triggerText} - ${action.reason}\n`;
    });
    md += `\n`;

    if (report.analysis?.contextChains) {
      const contextAnalysis = report.analysis.contextChains;
      md += `## 上下文链分析\n\n`;
      md += `- 已启用: ${contextAnalysis.enabled ? '是' : '否'}\n`;
      md += `- 分析步数: ${contextAnalysis.analyzedSteps}\n`;
      md += `- 平均链长度: ${contextAnalysis.averageChainLength.toFixed(2)}\n`;
      md += `- 最大链长度: ${contextAnalysis.maxChainLength}\n`;
      md += `- 平均前置上下文 Tokens: ${contextAnalysis.averageContextTokensBefore.toFixed(2)}\n`;
      md += `- 最大前置上下文 Tokens: ${contextAnalysis.maxContextTokensBefore}\n`;
      if (contextAnalysis.outputPath) {
        md += `- 逐步上下文产物: ${contextAnalysis.outputPath}\n`;
      }
      if (contextAnalysis.contextChainMapPath) {
        md += `- 上下文链映射: ${contextAnalysis.contextChainMapPath}\n`;
      }
      md += `\n`;
    }

    if (report.analysis?.standardEventStream) {
      const eventStream = report.analysis.standardEventStream;
      md += `## 标准事件流\n\n`;
      md += `- 总事件数: ${eventStream.totalEvents}\n`;
      md += `- message 事件: ${eventStream.messageEvents}\n`;
      md += `- tool_call 事件: ${eventStream.toolCallEvents}\n`;
      md += `- tool_result 事件: ${eventStream.toolResultEvents}\n`;
      md += `- 压缩相关事件: ${eventStream.compressedEvents}\n`;
      if (eventStream.outputPath) {
        md += `- 事件流产物: ${eventStream.outputPath}\n`;
      }
      md += `\n`;
    }

    // 各维度摘要
    md += `## 维度摘要\n\n`;
    md += `| 维度 | 告警 | 错误 |\n`;
    md += `|------|------|------|\n`;
    md += `| 任务结果 | ${report.dimensions.taskOutcome.warnings} | ${report.dimensions.taskOutcome.errors} |\n`;
    md += `| 上下文管理 | ${report.dimensions.contextManagement.warnings} | ${report.dimensions.contextManagement.errors} |\n`;
    md += `| 工具使用效率 | ${report.dimensions.toolUseEfficiency.warnings} | ${report.dimensions.toolUseEfficiency.errors} |\n`;
    md += `| 工作流架构 | ${report.dimensions.workflowArchitecture.warnings} | ${report.dimensions.workflowArchitecture.errors} |\n`;
    md += `| 工具生态一致性 | ${report.dimensions.toolEcosystemConsistency.warnings} | ${report.dimensions.toolEcosystemConsistency.errors} |\n\n`;

    // 关键问题
    if (report.summary.keyIssues.length > 0) {
      md += `## 关键问题\n\n`;
      report.summary.keyIssues.forEach((issue, i) => {
        md += `${i + 1}. ${issue}\n`;
      });
      md += `\n`;
    }

    // 优势
    if (report.summary.strengths.length > 0) {
      md += `## 优势\n\n`;
      report.summary.strengths.forEach((strength, i) => {
        md += `${i + 1}. ${strength}\n`;
      });
      md += `\n`;
    }

    if (report.findings.length > 0) {
      md += `## 高风险 Findings\n\n`;
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

    // 详细诊断
    if (report.diagnostics.length > 0) {
      md += `## 详细诊断\n\n`;

      // 按严重程度分组
      const errors = report.diagnostics.filter(d => d.severity === 'error');
      const warnings = report.diagnostics.filter(d => d.severity === 'warning');

      if (errors.length > 0) {
        md += `### 错误 (${errors.length})\n\n`;
        errors.forEach((issue, i) => {
          md += this.formatIssue(issue, i + 1);
        });
      }

      if (warnings.length > 0) {
        md += `### 告警 (${warnings.length})\n\n`;
        warnings.forEach((issue, i) => {
          md += this.formatIssue(issue, i + 1);
        });
      }
    }

    // 维度详情
    md += `## 维度详情\n\n`;
    md += this.formatDimensionDetails(report);

    return md;
  }

  /**
   * 格式化问题
   */
  private formatIssue(issue: any, index: number): string {
    let md = `#### ${index}. ${issue.message}\n\n`;
    md += `- **指标**: ${issue.metric}\n`;
    md += `- **严重程度**: ${issue.severity}\n`;

    if (issue.location) {
      if (issue.location.stepRange) {
        md += `- **位置**: 步骤 ${issue.location.stepRange[0]} - ${issue.location.stepRange[1]}\n`;
      }
      if (issue.location.messageUuid) {
        md += `- **消息UUID**: ${issue.location.messageUuid}\n`;
      }
    }

    if (issue.suggestion) {
      md += `- **建议**: ${issue.suggestion}\n`;
    }

    md += `\n`;
    return md;
  }

  /**
   * 格式化维度详情
   */
  private formatDimensionDetails(report: EvaluationReport): string {
    let md = '';

    // 上下文管理
    md += `### 上下文管理\n\n`;
    md += `- Ghost Context: ${report.dimensions.contextManagement.details.ghostContext.warnings} 告警, ${report.dimensions.contextManagement.details.ghostContext.errors} 错误\n`;
    md += `- Oversized Rules: ${report.dimensions.contextManagement.details.oversizedRules.warnings} 告警, ${report.dimensions.contextManagement.details.oversizedRules.errors} 错误\n`;
    md += `- Context Thrashing: ${report.dimensions.contextManagement.details.thrashing.warnings} 告警, ${report.dimensions.contextManagement.details.thrashing.errors} 错误\n\n`;

    // 工具使用效率
    md += `### 工具使用效率\n\n`;
    md += `- Tool Call Chain: ${report.dimensions.toolUseEfficiency.details.toolCallChain.warnings} 告警, ${report.dimensions.toolUseEfficiency.details.toolCallChain.errors} 错误\n`;
    md += `- Dead Step: ${report.dimensions.toolUseEfficiency.details.deadStep.warnings} 告警, ${report.dimensions.toolUseEfficiency.details.deadStep.errors} 错误\n`;
    md += `- Duplicate Step: ${report.dimensions.toolUseEfficiency.details.duplicateStep.warnings} 告警, ${report.dimensions.toolUseEfficiency.details.duplicateStep.errors} 错误\n\n`;

    // 工作流架构
    md += `### 工作流架构\n\n`;
    md += `- Wrapper Workflow: ${report.dimensions.workflowArchitecture.details.wrapperWorkflow.warnings} 告警, ${report.dimensions.workflowArchitecture.details.wrapperWorkflow.errors} 错误\n`;
    md += `- Context Coupling: ${report.dimensions.workflowArchitecture.details.contextCoupling.warnings} 告警, ${report.dimensions.workflowArchitecture.details.contextCoupling.errors} 错误\n`;
    md += `- Long Chain: ${report.dimensions.workflowArchitecture.details.longChain.warnings} 告警, ${report.dimensions.workflowArchitecture.details.longChain.errors} 错误\n\n`;

    // 工具生态一致性
    md += `### 工具生态一致性\n\n`;
    md += `- Inconsistent Tool Interface: ${report.dimensions.toolEcosystemConsistency.details.inconsistentToolInterface.warnings} 告警, ${report.dimensions.toolEcosystemConsistency.details.inconsistentToolInterface.errors} 错误\n`;
    md += `- Weak Tool: ${report.dimensions.toolEcosystemConsistency.details.weakTool.warnings} 告警, ${report.dimensions.toolEcosystemConsistency.details.weakTool.errors} 错误\n\n`;

    md += `### 风险维度摘要\n\n`;
    md += `- Context Management: avg posterior ${report.risk.dimensions.contextManagement.averagePosteriorRisk.toFixed(2)}, max posterior ${report.risk.dimensions.contextManagement.maxPosteriorRisk.toFixed(2)}\n`;
    md += `- Tool Use Efficiency: avg posterior ${report.risk.dimensions.toolUseEfficiency.averagePosteriorRisk.toFixed(2)}, max posterior ${report.risk.dimensions.toolUseEfficiency.maxPosteriorRisk.toFixed(2)}\n`;
    md += `- Workflow Architecture: avg posterior ${report.risk.dimensions.workflowArchitecture.averagePosteriorRisk.toFixed(2)}, max posterior ${report.risk.dimensions.workflowArchitecture.maxPosteriorRisk.toFixed(2)}\n`;
    md += `- Tool Ecosystem: avg posterior ${report.risk.dimensions.toolEcosystemConsistency.averagePosteriorRisk.toFixed(2)}, max posterior ${report.risk.dimensions.toolEcosystemConsistency.maxPosteriorRisk.toFixed(2)}\n\n`;

    return md;
  }

  /**
   * 保存报告到文件
   */
  async saveReport(
    report: EvaluationReport,
    outputDir: string,
    formats: Array<'json' | 'markdown'> = ['json', 'markdown']
  ): Promise<void> {
    // 确保输出目录存在
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const baseFilename = `evaluation-${report.runId}`;

    // 保存JSON
    if (formats.includes('json')) {
      const jsonPath = path.join(outputDir, `${baseFilename}.json`);
      fs.writeFileSync(jsonPath, this.generateJSON(report), 'utf-8');
    }

    // 保存Markdown
    if (formats.includes('markdown')) {
      const mdPath = path.join(outputDir, `${baseFilename}.md`);
      fs.writeFileSync(mdPath, this.generateMarkdown(report), 'utf-8');

      // 如果存在 compare-summary 则自动附加到报告末尾（增强可读性）
      try {
        const comparePath = path.join(process.cwd(), 'output', 'benchmark', 'compare-summary.md');
        if (fs.existsSync(comparePath)) {
          const compare = fs.readFileSync(comparePath, 'utf-8');
          const section = `\n\n## 整改前/后对比\n\n${compare}\n`;
          fs.appendFileSync(mdPath, section, 'utf-8');
        }
      } catch (_) {
        // 忽略附加异常，不影响主流程
      }
    }
  }
}
