import * as path from 'path';
import { SessionData, ToolUseInfo } from '../../ClaudeCodeStructure/src/types';
import { IDetector, DetectionIssue, Severity, EvaluationConfig } from '../types/evaluation.types';
import { writePrewarn } from '../utils/Prewarn';
import { AstAnalyzer } from '../analyzers/AstAnalyzer';
import { ProjectAstLoader } from '../analyzers/ProjectAstLoader';
import { finalizeDetectorIssues } from './detector-calibration';

interface ToolSchemaSnapshot {
  paramNames: string[];
  paramTypes: Record<string, string[]>;
  resultKinds: string[];
  resultSymbolKinds: Record<string, number>;
}

interface ToolContextProfile {
  files: Set<string>;
  neighborhoodFiles: Set<string>;
  extensions: Set<string>;
  symbolKinds: Record<string, number>;
}

/**
 * 接口一致性检测器
 * 检测功能相似的工具，接口不一致
 */
export class InterfaceConsistencyDetector implements IDetector {
  readonly name = 'InterfaceConsistencyDetector';
  private sessionData: SessionData;
  private config: EvaluationConfig;
  private ast?: AstAnalyzer;
  private projectAst?: ProjectAstLoader;

  // 预定义的工具功能分组
  private readonly toolClusters = {
    file_read: ['Read', 'Grep', 'Glob'],
    file_write: ['Write', 'Edit'],
    execution: ['Bash', 'Agent'],
    search: ['Grep', 'Glob', 'WebSearch'],
    web: ['WebFetch', 'WebSearch'],
  };

  constructor(sessionData: SessionData, config: EvaluationConfig) {
    this.sessionData = sessionData;
    this.config = config;
    this.ast = new AstAnalyzer();
    this.ast.init().catch(() => { /* optional */ });
    try {
      const projectAstPath = path.join(process.cwd(), 'output/project-ast.json');
      this.projectAst = new ProjectAstLoader(projectAstPath);
      this.projectAst.load();
    } catch (e) {
      this.projectAst = undefined;
    }
  }

  async detect(): Promise<DetectionIssue[]> {
    const issues: DetectionIssue[] = [];

    const usedTools = this.collectUsedTools();

    for (const [clusterName, toolNames] of Object.entries(this.toolClusters)) {
      const clusterTools = toolNames.filter((name) => usedTools.has(name));

      if (clusterTools.length >= 2) {
        const analysis = this.analyzeCluster(clusterTools, usedTools);

        if (analysis.interfaceRisk > 0.35 && analysis.interfaceRisk <= 0.4) {
          writePrewarn({
            metric: 'inconsistentToolInterface',
            message: `接口差异接近阈值: ${(analysis.interfaceRisk * 100).toFixed(0)}%`,
            details: { cluster: clusterTools, semanticOverlap: analysis.semanticOverlap },
          });
        }

        if (analysis.interfaceRisk > 0.4) {
          const severity = analysis.interfaceRisk > 0.7 ? Severity.Error : Severity.Warning;
          const deduction = severity === Severity.Error ? 2.0 : 1.0;

          issues.push({
            metric: 'inconsistentToolInterface',
            severity,
            message: `检测到工具接口不一致: ${clusterName}组的接口风险 ${(analysis.interfaceRisk * 100).toFixed(0)}%`,
            location: {},
            suggestion: `功能相似且作用于同一代码区域的工具应该有更一致的接口设计。考虑统一参数命名、返回结构与使用约定`,
            evidence: {
              type: severity === Severity.Error ? 'strong' : 'medium',
              details: {
                cluster: clusterTools,
                schemaDifference: analysis.schemaDifference,
                semanticOverlap: analysis.semanticOverlap,
                interfaceRisk: analysis.interfaceRisk,
                examples: analysis.examples,
              },
            },
            deduction,
          });
        }
      }
    }

    const dispersionIssues = this.analyzeUsageDispersion(usedTools);
    issues.push(...dispersionIssues);

    return finalizeDetectorIssues(issues, this.config);
  }

  /**
   * 收集使用过的工具
   */
  private collectUsedTools(): Map<string, ToolUseInfo[]> {
    const tools = new Map<string, ToolUseInfo[]>();

    for (const toolUse of this.sessionData.toolUses.values()) {
      if (!tools.has(toolUse.name)) {
        tools.set(toolUse.name, []);
      }
      tools.get(toolUse.name)!.push(toolUse);
    }

    return tools;
  }

  /**
   * 分析工具集群的一致性
   */
  private analyzeCluster(
    toolNames: string[],
    usedTools: Map<string, ToolUseInfo[]>
  ): {
    schemaDifference: number;
    semanticOverlap: number;
    interfaceRisk: number;
    examples: Array<{ tool: string; schema: ToolSchemaSnapshot; context: Record<string, unknown> }>;
  } {
    const schemas: Array<{ tool: string; schema: ToolSchemaSnapshot }> = [];
    const contexts: Array<{ tool: string; profile: ToolContextProfile }> = [];

    for (const toolName of toolNames) {
      const toolUses = usedTools.get(toolName) || [];
      if (toolUses.length === 0) {
        continue;
      }
      schemas.push({ tool: toolName, schema: this.extractSchema(toolUses) });
      contexts.push({ tool: toolName, profile: this.buildContextProfile(toolUses) });
    }

    const schemaDifference = this.calculateSchemaDifference(schemas.map((item) => item.schema));
    const semanticOverlap = this.calculateSemanticOverlap(contexts.map((item) => item.profile));
    let interfaceRisk = schemaDifference * (0.65 + 0.35 * semanticOverlap);

    if (semanticOverlap > 0.75 && schemaDifference > 0.3) {
      interfaceRisk += 0.05;
    }

    return {
      schemaDifference,
      semanticOverlap,
      interfaceRisk: Math.min(interfaceRisk, 1),
      examples: schemas.slice(0, 3).map((schemaItem, index) => ({
        tool: schemaItem.tool,
        schema: schemaItem.schema,
        context: this.summarizeContext(contexts[index]?.profile),
      })),
    };
  }

  /**
   * 提取工具的 schema。
   */
  private extractSchema(toolUses: ToolUseInfo[]): ToolSchemaSnapshot {
    const schema = {
      paramNames: new Set<string>(),
      paramTypes: new Map<string, Set<string>>(),
      resultKinds: new Set<string>(),
      resultSymbolKinds: {
        classes: 0,
        functions: 0,
        methods: 0,
        properties: 0,
        variables: 0,
        calls: 0,
      },
    };

    const samples = toolUses.slice(0, 5);

    for (const toolUse of samples) {
      const input = toolUse.input || {};

      for (const [key, value] of Object.entries(input)) {
        schema.paramNames.add(key);

        const type = Array.isArray(value) ? 'array' : typeof value;
        if (!schema.paramTypes.has(key)) {
          schema.paramTypes.set(key, new Set());
        }
        schema.paramTypes.get(key)!.add(type);
      }

      const result = this.sessionData.toolResults.get(toolUse.id);
      if (result) {
        const text = this.extractResultContent(result.content);
        for (const kind of this.classifyResultKinds(text, result.content)) {
          schema.resultKinds.add(kind);
        }
        this.incrementSymbolKinds(schema.resultSymbolKinds, text, toolUse.input?.file_path || toolUse.input?.path);
      }
    }

    const paramTypesObj: Record<string, string[]> = {};
    for (const [key, valueSet] of schema.paramTypes.entries()) {
      paramTypesObj[key] = Array.from(valueSet).sort();
    }

    return {
      paramNames: Array.from(schema.paramNames).sort(),
      paramTypes: paramTypesObj,
      resultKinds: Array.from(schema.resultKinds).sort(),
      resultSymbolKinds: schema.resultSymbolKinds,
    };
  }

  /**
   * 构建工具的代码上下文画像。
   */
  private buildContextProfile(toolUses: ToolUseInfo[]): ToolContextProfile {
    const profile: ToolContextProfile = {
      files: new Set<string>(),
      neighborhoodFiles: new Set<string>(),
      extensions: new Set<string>(),
      symbolKinds: {
        classes: 0,
        functions: 0,
        methods: 0,
        properties: 0,
        variables: 0,
        calls: 0,
      },
    };

    for (const toolUse of toolUses.slice(0, 8)) {
      const toolFiles = this.extractToolPaths(toolUse);
      for (const file of toolFiles) {
        profile.files.add(file);
        const ext = path.extname(file);
        if (ext) {
          profile.extensions.add(ext);
        }

        if (this.projectAst) {
          for (const related of this.projectAst.getRelatedNeighborhood([file], 1, true)) {
            profile.neighborhoodFiles.add(related);
          }
          const projectFile = this.projectAst.getFile(file);
          if (projectFile) {
            profile.symbolKinds.classes += projectFile.symbols.classes.length;
            profile.symbolKinds.functions += projectFile.symbols.functions.length;
            profile.symbolKinds.methods += projectFile.symbols.methods.length;
            profile.symbolKinds.properties += projectFile.symbols.properties.length;
            profile.symbolKinds.variables += projectFile.symbols.variables.length;
            profile.symbolKinds.calls += projectFile.symbols.calls.length;
          }
        } else {
          profile.neighborhoodFiles.add(file);
        }
      }

      const result = this.sessionData.toolResults.get(toolUse.id);
      if (result) {
        const text = this.extractResultContent(result.content);
        this.incrementSymbolKinds(profile.symbolKinds, text, toolUse.input?.file_path || toolUse.input?.path);
      }
    }

    return profile;
  }

  /**
   * 计算 schema 差异。
   */
  private calculateSchemaDifference(schemas: ToolSchemaSnapshot[]): number {
    if (schemas.length < 2) {
      return 0;
    }

    let totalDifference = 0;
    let comparisons = 0;

    for (let i = 0; i < schemas.length; i++) {
      for (let j = i + 1; j < schemas.length; j++) {
        totalDifference += this.compareSchemas(schemas[i], schemas[j]);
        comparisons += 1;
      }
    }

    return comparisons > 0 ? totalDifference / comparisons : 0;
  }

  private compareSchemas(schema1: ToolSchemaSnapshot, schema2: ToolSchemaSnapshot): number {
    const params1 = new Set(schema1.paramNames);
    const params2 = new Set(schema2.paramNames);
    const paramDifference = 1 - this.calculateSetSimilarity(params1, params2);

    const intersection = new Set<string>([...params1].filter((item) => params2.has(item)));
    let typeInconsistency = 0;
    for (const param of intersection) {
      const types1 = schema1.paramTypes[param] || [];
      const types2 = schema2.paramTypes[param] || [];
      const commonTypes = types1.filter((type) => types2.includes(type));
      if (types1.length > 0 && types2.length > 0 && commonTypes.length === 0) {
        typeInconsistency += 1;
      }
    }
    const typeDifference = intersection.size > 0 ? typeInconsistency / intersection.size : 0;

    const resultKindDifference = 1 - this.calculateSetSimilarity(
      new Set(schema1.resultKinds),
      new Set(schema2.resultKinds)
    );
    const resultSymbolDifference = 1 - this.calculateKindSimilarity(schema1.resultSymbolKinds, schema2.resultSymbolKinds);

    const inputDifference = paramDifference * 0.7 + typeDifference * 0.3;
    return inputDifference * 0.7 + resultKindDifference * 0.15 + resultSymbolDifference * 0.15;
  }

  /**
   * 计算工具在代码语义空间中的重合度。
   */
  private calculateSemanticOverlap(profiles: ToolContextProfile[]): number {
    if (profiles.length < 2) {
      return 1;
    }

    let totalOverlap = 0;
    let comparisons = 0;

    for (let i = 0; i < profiles.length; i++) {
      for (let j = i + 1; j < profiles.length; j++) {
        totalOverlap += this.compareContextProfiles(profiles[i], profiles[j]);
        comparisons += 1;
      }
    }

    return comparisons > 0 ? totalOverlap / comparisons : 1;
  }

  private compareContextProfiles(profile1: ToolContextProfile, profile2: ToolContextProfile): number {
    const fileOverlap = this.calculateSetSimilarity(profile1.neighborhoodFiles, profile2.neighborhoodFiles);
    const extensionOverlap = this.calculateSetSimilarity(profile1.extensions, profile2.extensions);
    const symbolOverlap = this.calculateKindSimilarity(profile1.symbolKinds, profile2.symbolKinds);

    if (
      profile1.neighborhoodFiles.size === 0 &&
      profile2.neighborhoodFiles.size === 0 &&
      profile1.extensions.size === 0 &&
      profile2.extensions.size === 0
    ) {
      return 1;
    }

    return fileOverlap * 0.5 + extensionOverlap * 0.2 + symbolOverlap * 0.3;
  }

  /**
   * 分析工具使用的分散度。
   */
  private analyzeUsageDispersion(usedTools: Map<string, ToolUseInfo[]>): DetectionIssue[] {
    const issues: DetectionIssue[] = [];

    for (const [clusterName, toolNames] of Object.entries(this.toolClusters)) {
      const clusterUsage = new Map<string, number>();
      let totalUsage = 0;

      for (const toolName of toolNames) {
        const count = (usedTools.get(toolName) || []).length;
        if (count > 0) {
          clusterUsage.set(toolName, count);
          totalUsage += count;
        }
      }

      if (clusterUsage.size >= 2 && totalUsage >= 5) {
        let entropy = 0;
        for (const count of clusterUsage.values()) {
          const p = count / totalUsage;
          entropy -= p * Math.log2(p);
        }

        const maxEntropy = Math.log2(clusterUsage.size);
        const dispersion = maxEntropy > 0 ? entropy / maxEntropy : 0;
        const semanticOverlap = this.calculateSemanticOverlap(
          Array.from(clusterUsage.keys()).map((toolName) => this.buildContextProfile(usedTools.get(toolName) || []))
        );
        const contextMultiplier = this.projectAst ? (0.65 + 0.35 * semanticOverlap) : 1;
        const effectiveDispersion = dispersion * contextMultiplier;

        if (effectiveDispersion > 0.75 && effectiveDispersion <= 0.8) {
          writePrewarn({
            metric: 'inconsistentToolInterface',
            message: `工具使用分散度接近阈值: ${(effectiveDispersion * 100).toFixed(0)}%`,
            details: { cluster: clusterName, tools: Object.fromEntries(clusterUsage), semanticOverlap },
          });
        }

        if (effectiveDispersion > 0.8) {
          issues.push({
            metric: 'inconsistentToolInterface',
            severity: Severity.Warning,
            message: `${clusterName}组工具在相近代码场景中的使用高度分散 (分散度: ${(effectiveDispersion * 100).toFixed(0)}%)，可能表示接口不够清晰`,
            location: {},
            suggestion: `考虑明确各工具的使用场景，或统一相近工具在同一代码任务中的调用方式`,
            evidence: {
              type: 'medium',
              details: {
                cluster: clusterName,
                tools: Object.fromEntries(clusterUsage),
                dispersion,
                semanticOverlap,
                effectiveDispersion,
              },
            },
            deduction: 1.0,
          });
        }
      }
    }

    return issues;
  }

  private extractToolPaths(toolUse: ToolUseInfo): string[] {
    const paths = new Set<string>();
    for (const key of ['file_path', 'path']) {
      const value = toolUse.input?.[key];
      if (typeof value === 'string' && value.trim()) {
        paths.add(value);
      }
    }
    if (toolUse.name === 'Bash') {
      const command = String(toolUse.input?.command || '');
      for (const match of command.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g) || []) {
        paths.add(match);
      }
    }
    return Array.from(paths);
  }

  private extractResultContent(content: any): string {
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

  private classifyResultKinds(text: string, rawContent: any): string[] {
    const kinds = new Set<string>();

    if (Array.isArray(rawContent)) {
      kinds.add('structured_blocks');
    } else if (typeof rawContent === 'object' && rawContent) {
      kinds.add('json_like');
    } else {
      kinds.add('text');
    }

    const normalized = text.trim();
    if (!normalized) {
      kinds.add('empty');
      return Array.from(kinds);
    }

    if (normalized.startsWith('{') || normalized.startsWith('[')) {
      kinds.add('json_text');
    }
    if (/[A-Za-z0-9_\-./]+\.[A-Za-z0-9]+/.test(normalized)) {
      kinds.add('path_like');
    }
    if (this.ast) {
      const extracted = this.ast.extractSymbols(normalized);
      if (
        extracted.classes.length > 0 ||
        extracted.functions.length > 0 ||
        extracted.methods.length > 0 ||
        extracted.properties.length > 0
      ) {
        kinds.add('code_like');
      }
    }

    return Array.from(kinds);
  }

  private incrementSymbolKinds(target: Record<string, number>, text: string, filePath?: string): void {
    if (!this.ast || !text) {
      return;
    }

    const extracted = this.ast.extractSymbols(text, { filePath });
    target.classes += extracted.classes.length;
    target.functions += extracted.functions.length;
    target.methods += extracted.methods.length;
    target.properties += extracted.properties.length;
    target.variables += extracted.variables.length;
    target.calls += extracted.calls.length;
  }

  private calculateSetSimilarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) {
      return 1;
    }

    const union = new Set<string>([...a, ...b]);
    let intersection = 0;
    for (const item of a) {
      if (b.has(item)) {
        intersection += 1;
      }
    }
    return union.size > 0 ? intersection / union.size : 0;
  }

  private calculateKindSimilarity(a: Record<string, number>, b: Record<string, number>): number {
    const keys = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
    let minSum = 0;
    let maxSum = 0;

    for (const key of keys) {
      const av = a[key] || 0;
      const bv = b[key] || 0;
      minSum += Math.min(av, bv);
      maxSum += Math.max(av, bv);
    }

    return maxSum > 0 ? minSum / maxSum : 1;
  }

  private summarizeContext(profile?: ToolContextProfile): Record<string, unknown> {
    if (!profile) {
      return {};
    }
    return {
      files: Array.from(profile.files).slice(0, 5),
      neighborhoodSize: profile.neighborhoodFiles.size,
      extensions: Array.from(profile.extensions).sort(),
      symbolKinds: profile.symbolKinds,
    };
  }
}
