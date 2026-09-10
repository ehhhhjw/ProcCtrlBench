# Claude Code JSONL Parser

一个用于解析和分析 Claude Code 会话数据的 TypeScript 库。支持完整的 JSONL 格式解析、消息关系构建、分支追踪、工具使用分析等功能。

## 功能特性

- ✅ **完整的 JSONL 解析**：支持 22 种 Entry 类型组合
- ✅ **三阶段解析架构**：收集条目 → 构建关系 → 计算统计
- ✅ **消息关系追踪**：父子消息链、分支树、时间线排序
- ✅ **流式响应处理**：合并相同 message.id 的多个片段
- ✅ **工具使用分析**：工具调用模式、成功率、性能统计
- ✅ **分支管理**：主分支/侧链识别、Agent 分支追踪
- ✅ **内容替换追踪**：工具结果的内容替换记录
- ✅ **多格式导出**：JSON、CSV、Markdown、Graph、DOT
- ✅ **会话分析**：对话流分析、工具使用模式、分支使用统计

## 安装

```bash
npm install
```

## 快速开始

### 基础用法

```typescript
import { parseSessionFile } from './src/index';

// 解析 JSONL 文件
const sessionData = parseSessionFile('path/to/session.jsonl');

// 获取基本统计
const stats = sessionData.query.getStatistics();
console.log(`总消息数: ${stats.totalMessages}`);
console.log(`工具调用数: ${stats.totalToolUses}`);
console.log(`Agent 数量: ${stats.totalAgents}`);
```

### 查询消息

```typescript
// 获取主分支消息
const mainMessages = sessionData.query.getMainBranchMessages();

// 按类型查询
const userMessages = sessionData.query.getMessagesByType('user');
const assistantMessages = sessionData.query.getMessagesByType('assistant');

// 获取对话链
const chain = sessionData.query.getConversationChain(messageUuid);

// 搜索消息
const results = sessionData.query.searchMessages('关键词');
```

### 工具使用分析

```typescript
// 获取所有工具使用
const toolUses = sessionData.query.getAllToolUses();

// 按工具名称查询
const readFileUses = sessionData.query.getToolUsesByName('read_file');

// 分析工具使用模式
const patterns = sessionData.analyzer.analyzeToolUsagePatterns();
patterns.forEach(pattern => {
  console.log(`工具: ${pattern.toolName}`);
  console.log(`使用次数: ${pattern.usageCount}`);
  console.log(`成功率: ${pattern.successRate}%`);
});
```

### 会话分析

```typescript
// 分析对话流
const flow = sessionData.analyzer.analyzeConversationFlow();
console.log(`主分支消息数: ${flow.mainBranchFlow.messageCount}`);
console.log(`平均响应时间: ${flow.mainBranchFlow.averageResponseTime}ms`);

// 分析分支使用
const branchAnalysis = sessionData.analyzer.analyzeBranchUsage();
console.log(`总分支数: ${branchAnalysis.totalBranches}`);
console.log(`活跃分支数: ${branchAnalysis.activeBranches}`);
```

### 数据导出

```typescript
// 导出为 JSON
const json = sessionData.exporter.toJSON();

// 导出为 Markdown
const markdown = sessionData.exporter.toMarkdown();

// 导出为图数据
const graph = sessionData.exporter.toGraphData();

// 导出为 DOT 格式（用于 Graphviz）
const dot = sessionData.exporter.toDOT();
```

## 架构设计

### 核心类

#### SessionDataImpl
会话数据的核心实现类，负责：
- 存储所有消息、Agent、工具使用等数据
- 构建消息关系（父子链、分支树）
- 维护时间线排序
- 提供基础查询接口

#### JsonlParser
三阶段 JSONL 解析器：
1. **第一阶段**：逐行解析 JSONL，收集所有条目
2. **第二阶段**：构建消息关系、分支树、时间线
3. **第三阶段**：计算统计信息、验证数据完整性

#### SessionDataQuery
高级查询接口，提供：
- 主分支/侧链消息查询
- Agent 消息过滤
- 对话链追踪
- 流式片段合并
- 工具使用查询
- 时间范围过滤
- 全文搜索

#### SessionDataExporter
多格式导出器，支持：
- JSON：完整数据结构
- CSV：表格化数据
- Markdown：可读性强的文档
- Graph：节点-边图数据
- DOT：Graphviz 可视化格式

#### SessionAnalyzer
会话分析器，提供：
- 对话流分析（消息数、响应时间、输入模式）
- 工具使用模式（使用频率、成功率、平均耗时）
- 分支使用统计（分支数、深度、活跃度）
- 内容替换模式（替换频率、类型分布）

### 数据类型

支持 22 种 JSONL Entry 类型组合：

**TranscriptMessage 类型**（4种）：
- `user` - 用户消息
- `assistant` - 助手消息
- `attachment` - 附件消息
- `system` - 系统消息

**Metadata 类型**（7种）：
- `custom-title` - 自定义标题
- `ai-title` - AI 生成标题
- `tag` - 标签
- `agent-name` - Agent 名称
- `mode` - 模式（plan/act）
- `worktree-state` - 工作树状态
- `pr-link` - PR 链接

**其他类型**（11种）：
- `agent` - Agent 定义
- `tool-use` - 工具调用
- `tool-result` - 工具结果
- `replacement` - 内容替换
- `error` - 错误信息
- `checkpoint` - 检查点
- `feedback` - 反馈
- `cost` - 成本记录
- `model-change` - 模型切换
- `session-start` - 会话开始
- `session-end` - 会话结束

### 关键概念

#### 消息关系
- **parentUuid**：指向父消息的 UUID，构建对话链
- **isSidechain**：标识是否为侧链消息
- **agentId**：关联的 Agent ID，用于分支追踪

#### 流式响应
- 多个 Entry 可能有相同的 `message.id` 但不同的 `uuid`
- 使用 `getStreamFragments()` 获取所有片段
- 使用 `mergeStreamFragments()` 合并为完整消息

#### 分支管理
- **主分支**：`isSidechain = false` 且无 `agentId`
- **Agent 分支**：有 `agentId` 的消息
- **侧链**：`isSidechain = true` 的消息

## API 文档

### SessionData

```typescript
interface SessionData {
  // 数据存储
  messages: Map<string, TranscriptMessageEntry>;
  agents: Map<string, AgentEntry>;
  toolUses: Map<string, ToolUseEntry>;
  toolResults: Map<string, ToolResultEntry>;
  replacements: Map<string, ReplacementEntry>;
  
  // 关系映射
  messageIdToUuids: Map<string, string[]>;
  parentToChildren: Map<string, string[]>;
  messageToReplacements: Map<string, string[]>;
  
  // 时间线
  timeline: string[];
  
  // 查询接口
  query: SessionDataQuery;
  exporter: SessionDataExporter;
  analyzer: SessionAnalyzer;
  
  // 基础方法
  getMessage(uuid: string): TranscriptMessageEntry | undefined;
  getMessagesByMessageId(messageId: string): TranscriptMessageEntry[];
  getAgent(agentId: string): AgentEntry | undefined;
  getToolUse(uuid: string): ToolUseEntry | undefined;
  getToolResult(uuid: string): ToolResultEntry | undefined;
  getReplacementsForMessage(messageUuid: string): ReplacementEntry[];
  getTimelineMessages(): TranscriptMessageEntry[];
  getSummary(): SessionSummary;
}
```

### SessionDataQuery

```typescript
interface SessionDataQuery {
  // 分支查询
  getMainBranchMessages(): TranscriptMessageEntry[];
  getAgentMessages(agentId: string): TranscriptMessageEntry[];
  getAllBranches(): Map<string, TranscriptMessageEntry[]>;
  getBranchTree(): BranchNode;
  
  // 对话链
  getConversationChain(messageUuid: string): TranscriptMessageEntry[];
  
  // 流式响应
  getStreamFragments(messageId: string): TranscriptMessageEntry[];
  mergeStreamFragments(messageId: string): TranscriptMessageEntry | null;
  
  // 工具查询
  getAllToolUses(): ToolUseEntry[];
  getToolUsesByName(toolName: string): ToolUseEntry[];
  getMessagesUsingTool(toolName: string): TranscriptMessageEntry[];
  
  // 统计信息
  getStatistics(): SessionStatistics;
  getTimeline(): TimelineEntry[];
  
  // 搜索过滤
  searchMessages(query: string): TranscriptMessageEntry[];
  getMessagesByType(type: TranscriptMessageType): TranscriptMessageEntry[];
  getMessagesInTimeRange(start: Date, end: Date): TranscriptMessageEntry[];
}
```

### SessionAnalyzer

```typescript
interface SessionAnalyzer {
  // 对话流分析
  analyzeConversationFlow(): ConversationFlow;
  
  // 工具使用分析
  analyzeToolUsagePatterns(): ToolUsagePattern[];
  
  // 分支使用分析
  analyzeBranchUsage(): BranchUsageAnalysis;
  
  // 替换模式分析
  analyzeReplacementPatterns(): ReplacementPattern[];
}
```

## 测试

运行测试套件：

```bash
npm test
```

运行示例代码：

```bash
npm run example
```

测试覆盖：
- ✅ JSONL 解析（所有 22 种类型）
- ✅ 消息关系构建
- ✅ 分支树构建
- ✅ 时间线排序
- ✅ 查询功能
- ✅ 工具使用分析
- ✅ 会话分析
- ✅ 数据导出
- ✅ 流式响应处理
- ✅ 搜索过滤

## 项目结构

```
ClaudeCodeStructure/
├── src/
│   ├── types.ts              # 所有类型定义（22种Entry类型）
│   ├── SessionData.ts        # 核心数据结构实现
│   ├── SessionDataQuery.ts   # 查询接口实现
│   ├── SessionDataExporter.ts # 导出功能实现
│   ├── SessionAnalyzer.ts    # 分析功能实现
│   ├── JsonlParser.ts        # JSONL解析器
│   └── index.ts              # 主入口文件
├── tests/
│   ├── sample.jsonl          # 测试数据（24条记录）
│   ├── test.ts               # 测试套件（17个测试用例）
│   └── example.ts            # 使用示例（10个示例）
├── package.json
├── tsconfig.json
└── README.md
```

## 许可证

MIT

## 贡献

欢迎提交 Issue 和 Pull Request！