import { SessionData, ToolUseInfo, MessageNode } from '../../ClaudeCodeStructure/src/types';
import { IDetector, DetectionIssue, Severity, EvaluationConfig } from '../types/evaluation.types';
import { DeadStepInfo } from '../types/metrics.types';
import { ContentSimilarityAnalyzer } from '../analyzers/ContentSimilarityAnalyzer';
import { FileAssociationLoader } from '../analyzers/FileAssociationLoader';
import { AstAnalyzer } from '../analyzers/AstAnalyzer';
import { ProjectAstLoader } from '../analyzers/ProjectAstLoader';
import { ContextChainAnalyzer } from '../analyzers/ContextChainAnalyzer';
import { finalizeDetectorIssues } from './detector-calibration';

/**
 * 死步骤检测器
 * 检测某步骤的结果未被后续流程有效引用
 */
export class DeadStepDetector implements IDetector {
  readonly name = 'DeadStepDetector';
  private sessionData: SessionData;
  private config: EvaluationConfig;
  private fileGraph?: FileAssociationLoader;
  private ast?: AstAnalyzer;
  private projectAst?: ProjectAstLoader;
  private contextChains: ContextChainAnalyzer;

  constructor(sessionData: SessionData, config: EvaluationConfig) {
    this.sessionData = sessionData;
    this.config = config;
    // 尝试加载文件图谱（可选）
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
    // 初始化AST分析器（可选）
    this.ast = new AstAnalyzer();
    this.ast.init().catch(() => { /* ignore */ });
    this.contextChains = new ContextChainAnalyzer(this.sessionData);
  }

  async detect(): Promise<DetectionIssue[]> {
    const issues: DetectionIssue[] = [];

    // 获取按时间排序的所有工具调用
    const toolUses = Array.from(this.sessionData.toolUses.values())
      .sort((a, b) => a.timestamp - b.timestamp);
    const orderedMessages = Array.from(this.sessionData.messages.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    for (let i = 0; i < toolUses.length; i++) {
      const toolUse = toolUses[i];
      const toolResult = this.sessionData.toolResults.get(toolUse.id);

      // 只检查有结果的工具调用
      if (!toolResult || toolResult.is_error) {
        continue;
      }

      // 写入类操作本身已经对外部状态产生了持久影响，不应判为 dead step。
      if (toolUse.name === 'Write') {
        continue;
      }

      if (this.isFinalCodeModificationStep(toolUse, toolUses, i)) {
        continue;
      }

      // 获取后续步骤
      const subsequentSteps = this.getSubsequentSteps(toolUse, toolUses.slice(i + 1));
      const subsequentMessages = this.getSubsequentMessages(toolUse, orderedMessages);
      const context = this.buildCodeContext(toolUse, toolResult);
      const hasContextCarry = this.isCarriedInSubsequentContext(toolUse, subsequentMessages);

      // 检查4个条件
      const checks = {
        noToolInputRef: !this.isReferencedInToolInputs(toolResult, subsequentSteps, context),
        noPlanRef: !this.isReferencedInPlans(toolResult, subsequentMessages, context),
        noFileRef: !this.isReferencedInFileOps(toolResult, subsequentSteps, context),
        noBranchImpact: !this.causedBranchChange(toolUse, subsequentSteps),
      };

      // 计算证据强度
      const failedChecks = Object.values(checks).filter(v => v).length;

      if (failedChecks >= 3) {
        if (hasContextCarry && failedChecks === 3) {
          continue;
        }

        // 强证据或中证据
        const evidenceType = failedChecks === 4 && !hasContextCarry ? 'strong' : 'medium';
        const severity = failedChecks === 4 && !hasContextCarry ? Severity.Error : Severity.Warning;
        const deduction = evidenceType === 'strong' ? 1.0 : 0.5;

        issues.push({
          metric: 'deadStep',
          severity,
          message: `检测到死步骤: ${toolUse.name} 的结果未被后续流程有效引用 (${failedChecks}/4个检查失败)`,
          location: {
            stepRange: [i, i],
            toolUseId: toolUse.id,
            messageUuid: toolUse.messageUuid,
          },
          suggestion: `该步骤的结果似乎未被使用。考虑移除此步骤或确保其结果被后续步骤引用`,
          evidence: {
            type: evidenceType,
            details: {
              toolName: toolUse.name,
                checks,
                failedChecks,
                hasContextCarry,
                resultPreview: this.getResultPreview(toolResult),
              },
            },
            deduction,
        });
      }
    }

    return finalizeDetectorIssues(issues, this.config);
  }

  private isFinalCodeModificationStep(
    toolUse: ToolUseInfo,
    orderedToolUses: ToolUseInfo[],
    index: number
  ): boolean {
    return this.isCodeModificationStep(toolUse) && index === orderedToolUses.length - 1;
  }

  private isCodeModificationStep(toolUse: ToolUseInfo): boolean {
    return toolUse.name === 'Write' || toolUse.name === 'Edit' || toolUse.name === 'MultiEdit';
  }

  /**
   * 获取后续步骤
   */
  private getSubsequentSteps(
    currentToolUse: ToolUseInfo,
    remainingToolUses: ToolUseInfo[]
  ): Array<{ toolUse: ToolUseInfo; message: MessageNode }> {
    const steps: Array<{ toolUse: ToolUseInfo; message: MessageNode }> = [];

    const checkWindow = remainingToolUses
      .filter((toolUse) => this.contextChains.isDescendant(toolUse.messageUuid, currentToolUse.messageUuid))
      .slice(0, 10);

    for (const toolUse of checkWindow) {
      const message = this.sessionData.messages.get(toolUse.messageUuid);
      if (message) {
        steps.push({ toolUse, message });
      }
    }

    return steps;
  }

  private getSubsequentMessages(
    currentToolUse: ToolUseInfo,
    orderedMessages: MessageNode[]
  ): MessageNode[] {
    return orderedMessages.filter((message) =>
      this.contextChains.isDescendant(message.uuid, currentToolUse.messageUuid)
    );
  }

  /**
   * 检查是否在后续工具输入中被引用
   */
  private isReferencedInToolInputs(
    toolResult: any,
    subsequentSteps: Array<{ toolUse: ToolUseInfo; message: MessageNode }>,
    context: { files: Set<string>; symbols: Set<string>; keywords: string[] }
  ): boolean {
    const resultContent = this.extractResultContent(toolResult);
    if (!resultContent) return false;

    for (const step of subsequentSteps) {
      const inputStr = JSON.stringify(step.toolUse.input);

      // 检查是否包含结果中的关键词
      for (const keyword of context.keywords) {
        if (inputStr.includes(keyword)) {
          return true;
        }
      }

      // 符号级引用：类/函数/方法名出现在后续输入中
      for (const sym of context.symbols) {
        if (sym && inputStr.includes(sym)) {
          return true;
        }
      }

      if (this.stepTouchesCodeContext(step.toolUse, context)) {
        return true;
      }

      // 检查文件路径引用
      if (step.toolUse.name === 'Read' || step.toolUse.name === 'Edit' || step.toolUse.name === 'Write') {
        const filePath = step.toolUse.input.file_path;
        if (filePath) {
          if (resultContent.includes(filePath)) return true;
        }
      }
    }

    return false;
  }

  /**
   * 检查是否在后续计划/思考中被引用
   */
  private isReferencedInPlans(
    toolResult: any,
    subsequentMessages: MessageNode[],
    context: { files: Set<string>; symbols: Set<string>; keywords: string[] }
  ): boolean {
    const resultContent = this.extractResultContent(toolResult);
    if (!resultContent) return false;

    for (const message of subsequentMessages) {
      // 检查assistant消息的文本内容
      if (message.type === 'assistant') {
        const messageText = this.extractMessageText(message.content);

        for (const keyword of context.keywords) {
          if (messageText.includes(keyword)) {
            return true;
          }
        }

        for (const sym of context.symbols) {
          if (sym && messageText.includes(sym)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * 检查是否在后续文件操作中被引用
   */
  private isReferencedInFileOps(
    toolResult: any,
    subsequentSteps: Array<{ toolUse: ToolUseInfo; message: MessageNode }>,
    context: { files: Set<string>; symbols: Set<string>; keywords: string[] }
  ): boolean {
    // 提取结果中提到的文件路径
    const resultContent = this.extractResultContent(toolResult);
    const filePaths = this.extractFilePaths(resultContent);
    for (const file of context.files) {
      filePaths.push(file);
    }

    if (filePaths.length === 0 && context.symbols.size === 0) return false;

    for (const step of subsequentSteps) {
      // 检查是否对相关文件进行了操作
      if (step.toolUse.name === 'Read' || step.toolUse.name === 'Edit' || step.toolUse.name === 'Write') {
        const targetFile = step.toolUse.input.file_path;

        if (targetFile) {
          for (const filePath of filePaths) {
            if (targetFile.includes(filePath)) return true;
            if (this.fileGraph) {
              const assoc = this.fileGraph.get(filePath);
              if (assoc.includes(targetFile)) return true;
            }
            if (this.projectAst?.areFilesRelated(filePath, targetFile)) return true;
          }

          if (context.symbols.size > 0 && this.projectAst) {
            if (this.projectAst.fileDefinesAnySymbol(targetFile, context.symbols)) {
              return true;
            }
            if (this.projectAst.fileUsesAnySymbol(targetFile, context.symbols)) {
              return true;
            }
          }
        }
      }
    }

    return false;
  }

  /**
   * 检查是否导致分支变化
   */
  private causedBranchChange(
    toolUse: ToolUseInfo,
    subsequentSteps: Array<{ toolUse: ToolUseInfo; message: MessageNode }>
  ): boolean {
    // 检查是否有新的Agent被创建
    const beforeAgents = new Set<string>();
    const afterAgents = new Set<string>();

    // 统计该步骤前后的agent
    for (const [agentId, agent] of this.sessionData.agents.entries()) {
      if (agent.createdAt < toolUse.timestamp) {
        beforeAgents.add(agentId);
      } else if (agent.createdAt > toolUse.timestamp) {
        afterAgents.add(agentId);
      }
    }

    // 如果有新agent创建，可能是该步骤的影响
    if (afterAgents.size > beforeAgents.size) {
      // 检查新agent是否在合理时间窗口内
      for (const agentId of afterAgents) {
        const agent = this.sessionData.agents.get(agentId);
        if (agent && Math.abs(agent.createdAt - toolUse.timestamp) < 10000) { // 10秒内
          return true;
        }
      }
    }

    return false;
  }

  /**
   * 检查该步骤是否仍被后续步骤的上下文链继承。
   * 这是弱使用信号：说明结果仍处于后续推理上下文中，但不等价于显式消费。
   */
  private isCarriedInSubsequentContext(
    toolUse: ToolUseInfo,
    subsequentMessages: MessageNode[]
  ): boolean {
    return subsequentMessages.some((message) =>
      this.contextChains.getChainUuids(message.uuid).includes(toolUse.messageUuid)
    );
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
   * 提取关键词
   */
  private extractKeywords(content: string): string[] {
    // 提取有意义的词（长度>=4）
    const words = content
      .split(/\s+/)
      .map(w => w.replace(/[^\w]/g, ''))
      .filter(w => w.length >= 4 && !/^\d+$/.test(w)); // 排除纯数字

    // 去重并返回前20个
    return [...new Set(words)].slice(0, 20);
  }

  /**
   * 提取消息文本
   */
  private extractMessageText(content: any): string {
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text || '')
        .join('\n');
    }

    return '';
  }

  /**
   * 提取文件路径
   */
  private extractFilePaths(content: string): string[] {
    const paths: string[] = [];

    // 匹配常见的文件路径模式
    const pathPatterns = [
      /[\w\/\-\.]+\.[a-zA-Z]{1,4}/g, // 带扩展名的路径
      /src\/[\w\/\-\.]+/g,             // src目录下的路径
      /\/[\w\/\-\.]+/g,                // 绝对路径
    ];

    for (const pattern of pathPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        paths.push(...matches);
      }
    }

    return [...new Set(paths)];
  }

  private buildCodeContext(toolUse: ToolUseInfo, toolResult: any): { files: Set<string>; symbols: Set<string>; keywords: string[] } {
    const resultContent = this.extractResultContent(toolResult);
    const files = new Set<string>([
      ...this.extractToolPaths(toolUse),
      ...this.extractFilePaths(resultContent),
    ]);

    const keywords = this.extractKeywords(resultContent);
    const symbols = new Set<string>();
    const extracted = this.ast ? this.ast.extractSymbols(resultContent, { filePath: toolUse.input.file_path }) : undefined;
    if (extracted) {
      for (const sym of [
        ...extracted.classes,
        ...extracted.functions,
        ...extracted.methods,
        ...(extracted.properties || []),
        ...(extracted.variables || []),
        ...(extracted.calls || []),
      ]) {
        if (sym) {
          symbols.add(sym);
        }
      }
    }

    if (this.projectAst) {
      for (const file of [...files]) {
        for (const declared of this.projectAst.getDeclaredSymbols(file)) {
          symbols.add(declared);
        }
      }
    }

    return { files, symbols, keywords };
  }

  private extractToolPaths(toolUse: ToolUseInfo): string[] {
    const paths = new Set<string>();
    const input = toolUse.input || {};
    for (const key of ['file_path', 'path']) {
      if (typeof input[key] === 'string' && input[key]) {
        paths.add(input[key]);
      }
    }
    return Array.from(paths);
  }

  private stepTouchesCodeContext(
    toolUse: ToolUseInfo,
    context: { files: Set<string>; symbols: Set<string>; keywords: string[] }
  ): boolean {
    const targetFiles = this.extractToolPaths(toolUse);
    if (targetFiles.length === 0) {
      return false;
    }

    for (const targetFile of targetFiles) {
      if (context.files.has(targetFile)) {
        return true;
      }
      for (const sourceFile of context.files) {
        if (this.projectAst?.areFilesRelated(sourceFile, targetFile)) {
          return true;
        }
        if (this.fileGraph?.get(sourceFile).includes(targetFile)) {
          return true;
        }
      }

      if (this.projectAst) {
        if (this.projectAst.fileDefinesAnySymbol(targetFile, context.symbols)) {
          return true;
        }
        if (this.projectAst.fileUsesAnySymbol(targetFile, context.symbols)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * 获取结果预览
   */
  private getResultPreview(result: any): string {
    const content = this.extractResultContent(result);
    return content.length > 100 ? content.substring(0, 100) + '...' : content;
  }
}
