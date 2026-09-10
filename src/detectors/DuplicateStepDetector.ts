import { SessionData, ToolUseInfo } from '../../ClaudeCodeStructure/src/types';
import { IDetector, DetectionIssue, Severity, EvaluationConfig } from '../types/evaluation.types';
import { DuplicateStepInfo } from '../types/metrics.types';
import { ContentSimilarityAnalyzer } from '../analyzers/ContentSimilarityAnalyzer';
import { FileAssociationLoader } from '../analyzers/FileAssociationLoader';
import { AstAnalyzer } from '../analyzers/AstAnalyzer';
import { ProjectAstLoader } from '../analyzers/ProjectAstLoader';
import { finalizeDetectorIssues } from './detector-calibration';

/**
 * 重复步骤检测器
 * 检测对同一资源执行重复步骤，期间状态未变
 */
export class DuplicateStepDetector implements IDetector {
  readonly name = 'DuplicateStepDetector';
  private sessionData: SessionData;
  private config: EvaluationConfig;
  private fileChangeTimestamps: Map<string, number> = new Map();
  private fileGraph?: FileAssociationLoader;
  private ast?: AstAnalyzer;
  private projectAst?: ProjectAstLoader;

  constructor(sessionData: SessionData, config: EvaluationConfig) {
    this.sessionData = sessionData;
    this.config = config;
    this.buildFileChangeHistory();
    // 可选：文件图谱
    try {
      const graphPath = require('path').join(process.cwd(), 'output/file-graph.json');
      this.fileGraph = new FileAssociationLoader(graphPath);
      this.fileGraph.load();
    } catch (e) {
      this.fileGraph = undefined;
    }
    try {
      const projectAstPath = require('path').join(process.cwd(), 'output/project-ast.json');
      this.projectAst = new ProjectAstLoader(projectAstPath);
      this.projectAst.load();
    } catch (e) {
      this.projectAst = undefined;
    }
    // 可选：AST
    this.ast = new AstAnalyzer();
    this.ast.init().catch(() => { /* ignore */ });
  }

  /**
   * 构建文件变更历史
   */
  private buildFileChangeHistory(): void {
    const toolUses = Array.from(this.sessionData.toolUses.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    for (const toolUse of toolUses) {
      // 记录文件写入时间
      if (toolUse.name === 'Write' || toolUse.name === 'Edit') {
        const filePath = toolUse.input.file_path;
        if (filePath) {
          this.fileChangeTimestamps.set(filePath, toolUse.timestamp);
        }
      }
    }
  }

  async detect(): Promise<DetectionIssue[]> {
    const issues: DetectionIssue[] = [];

    // 获取按时间排序的所有工具调用
    const toolUses = Array.from(this.sessionData.toolUses.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    // 为每个工具调用检查是否有重复
    for (let i = 0; i < toolUses.length; i++) {
      const currentToolUse = toolUses[i];

      // 查找之前的相似调用
      const duplicates = this.findSimilarCalls(currentToolUse, toolUses.slice(0, i));

      for (const dup of duplicates) {
        issues.push(this.createDuplicateIssue(dup, currentToolUse, i, dup.previousIndex));
      }
    }

    return finalizeDetectorIssues(issues, this.config);
  }

  /**
   * 查找相似的先前调用
   */
  private findSimilarCalls(
    currentToolUse: ToolUseInfo,
    previousToolUses: ToolUseInfo[]
  ): Array<DuplicateStepInfo & { previousIndex: number }> {
    const duplicates: Array<DuplicateStepInfo & { previousIndex: number }> = [];

    for (let i = previousToolUses.length - 1; i >= 0; i--) {
      const prevToolUse = previousToolUses[i];

      // 只比较相同类型的工具
      if (prevToolUse.name !== currentToolUse.name) continue;

      // 计算输入相似度
      const inputSimilarity = ContentSimilarityAnalyzer.calculateStructuralSimilarity(
        prevToolUse.input,
        currentToolUse.input
      );

      // 如果输入相似度高于90%
      if (inputSimilarity > 0.9) {
        // 检查期间文件是否变更
        const hasFileChanged = this.hasFileChangedBetween(
          prevToolUse,
          currentToolUse
        );

        // 如果文件没有变更,检查结果相似度
        if (!hasFileChanged) {
          const prevResult = this.sessionData.toolResults.get(prevToolUse.id);
          const currentResult = this.sessionData.toolResults.get(currentToolUse.id);

          let resultSimilarity = 0;

          if (prevResult && currentResult) {
            const prevContent = this.extractResultContent(prevResult);
            const currentContent = this.extractResultContent(currentResult);

            resultSimilarity = ContentSimilarityAnalyzer.calculateSimilarity(
              prevContent,
              currentContent
            );
          }

          const prevContent = prevResult ? this.extractResultContent(prevResult) : '';
          const currentContent = currentResult ? this.extractResultContent(currentResult) : '';
          const semanticDuplicate = this.isSemanticDuplicate(prevContent, currentContent, currentToolUse);

          // 如果结果也高度相似,或符号/调用层面高度重复，则认为是重复
          if (resultSimilarity > 0.9 || semanticDuplicate || (!prevResult && !currentResult)) {
            // 检查豁免条件
            if (!this.isExempt(currentToolUse)) {
              const type = inputSimilarity === 1.0 ? 'exact' : 'near';

              duplicates.push({
                type,
                currentStep: -1, // 将在外部填充
                previousStep: i,
                previousIndex: i,
                toolName: currentToolUse.name,
                inputSimilarity,
                resultSimilarity,
                timeDelta: currentToolUse.timestamp - prevToolUse.timestamp,
              });
            }
          }
        }
      }
    }

    return duplicates;
  }

  /**
   * 检查期间文件是否变更
   */
  private hasFileChangedBetween(
    prevToolUse: ToolUseInfo,
    currentToolUse: ToolUseInfo
  ): boolean {
    // 提取涉及的文件
    const files = new Set(this.extractFilePaths(currentToolUse.input));
    if (this.projectAst) {
      for (const file of [...files]) {
        for (const related of this.projectAst.getRelatedFiles(file, true)) {
          files.add(related);
        }
      }
    }

    for (const file of files) {
      const changeTime = this.fileChangeTimestamps.get(file);

      if (changeTime && changeTime > prevToolUse.timestamp && changeTime < currentToolUse.timestamp) {
        return true;
      }
      // 间接变更：若关联文件发生写入，也视为变更
      if (this.fileGraph) {
        const assoc = this.fileGraph.get(file);
        for (const af of assoc) {
          const changeTime2 = this.fileChangeTimestamps.get(af);
          if (changeTime2 && changeTime2 > prevToolUse.timestamp && changeTime2 < currentToolUse.timestamp) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * 提取文件路径
   */
  private extractFilePaths(input: any): string[] {
    const files: string[] = [];

    if (input.file_path) {
      files.push(input.file_path);
    }
    if (input.path) {
      files.push(input.path);
    }

    return files;
  }

  /**
   * 提取结果内容
   */
  private extractResultContent(result: any): string {
    if (typeof result.content === 'string') {
      return result.content;
    }

    if (Array.isArray(result.content)) {
      return result.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('\n');
    }

    return '';
  }

  /**
   * 语义重复增强：比较符号重合度以确认语义层面的重复。
   */
  private isSemanticDuplicate(prevContent: string, currContent: string, currentToolUse?: ToolUseInfo): boolean {
    if (!this.ast) return false;
    const filePath = currentToolUse?.input?.file_path || currentToolUse?.input?.path;
    const ps = this.ast.extractSymbols(prevContent, { filePath });
    const cs = this.ast.extractSymbols(currContent, { filePath });
    const pset = new Set([
      ...ps.classes,
      ...ps.functions,
      ...ps.methods,
      ...(ps.properties || []),
      ...(ps.variables || []),
      ...(ps.calls || []),
    ]);
    const cset = new Set([
      ...cs.classes,
      ...cs.functions,
      ...cs.methods,
      ...(cs.properties || []),
      ...(cs.variables || []),
      ...(cs.calls || []),
    ]);
    if (filePath && this.projectAst) {
      for (const sym of this.projectAst.getDeclaredSymbols(filePath)) {
        pset.add(sym);
        cset.add(sym);
      }
    }
    let inter = 0;
    for (const s of pset) if (cset.has(s)) inter++;
    const jaccard = (inter) / (pset.size + cset.size - inter || 1);
    return jaccard > 0.8;
  }

  /**
   * 检查豁免条件
   */
  private isExempt(toolUse: ToolUseInfo): boolean {
    // 豁免条件1: 命令天然时变(如git status, 时间相关命令)
    if (toolUse.name === 'Bash') {
      const command = toolUse.input.command;
      const timeVariantCommands = [
        'git status',
        'git log',
        'ps',
        'top',
        'date',
        'uptime',
      ];

      if (timeVariantCommands.some(cmd => command.includes(cmd))) {
        return true;
      }
    }

    // 豁免条件2: 验证性重复(测试命令)
    if (toolUse.name === 'Bash') {
      const command = toolUse.input.command;
      const testCommands = ['npm test', 'yarn test', 'pytest', 'jest', 'cargo test'];

      if (testCommands.some(cmd => command.includes(cmd))) {
        return true;
      }
    }

    return false;
  }

  /**
   * 创建重复问题
   */
  private createDuplicateIssue(
    dup: DuplicateStepInfo,
    currentToolUse: ToolUseInfo,
    currentIndex: number,
    previousIndex: number
  ): DetectionIssue {
    const isExact = dup.type === 'exact';
    const isHighCost = this.isHighCostTool(currentToolUse.name);

    const severity = (isExact && isHighCost) || dup.type === 'context_loss'
      ? Severity.Error
      : Severity.Warning;

    const deduction = severity === Severity.Error ? 1.5 : 0.5;

    return {
      metric: 'duplicateStep',
      severity,
      message: `检测到重复步骤: ${currentToolUse.name} 在步骤 ${previousIndex} 和 ${currentIndex} 执行了${isExact ? '完全' : '近似'}相同的操作`,
      location: {
        stepRange: [previousIndex, currentIndex],
        toolUseId: currentToolUse.id,
      },
      suggestion: `避免重复执行相同的操作。如果需要验证，可以在第一次执行后缓存结果`,
      evidence: {
        type: isExact ? 'strong' : 'medium',
        details: {
          toolName: currentToolUse.name,
          duplicateType: dup.type,
          isHighCost,
          inputSimilarity: dup.inputSimilarity,
          resultSimilarity: dup.resultSimilarity,
          timeDelta: dup.timeDelta,
        },
      },
      deduction,
    };
  }

  /**
   * 检查是否是高开销工具
   */
  private isHighCostTool(toolName: string): boolean {
    const highCostTools = ['Agent', 'Bash', 'WebFetch', 'WebSearch'];
    return highCostTools.includes(toolName);
  }
}
