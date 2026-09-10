# Claude Code JSONL Parser

A TypeScript library for parsing and analyzing Claude Code session data. It supports full JSONL format parsing, message relationship construction, branch tracking, tool use analysis, and more.

## Features

- ✅ **Full JSONL parsing**: supports 22 Entry type combinations
- ✅ **Three-phase parsing architecture**: collect entries → build relationships → compute statistics
- ✅ **Message relationship tracking**: parent-child message chains, branch trees, timeline ordering
- ✅ **Streaming response handling**: merges multiple fragments sharing the same message.id
- ✅ **Tool use analysis**: tool call patterns, success rates, performance statistics
- ✅ **Branch management**: main branch / sidechain identification, Agent branch tracking
- ✅ **Content replacement tracking**: records content replacements in tool results
- ✅ **Multi-format export**: JSON, CSV, Markdown, Graph, DOT
- ✅ **Session analysis**: conversation flow analysis, tool use patterns, branch usage statistics

## Install

```bash
npm install
```

## Quick Start

### Basic Usage

```typescript
import { parseSessionFile } from './src/index';

// Parse the JSONL file
const sessionData = parseSessionFile('path/to/session.jsonl');

// Get basic statistics
const stats = sessionData.query.getStatistics();
console.log(`Total messages: ${stats.totalMessages}`);
console.log(`Tool calls: ${stats.totalToolUses}`);
console.log(`Agent count: ${stats.totalAgents}`);
```

### Querying Messages

```typescript
// Get main branch messages
const mainMessages = sessionData.query.getMainBranchMessages();

// Query by type
const userMessages = sessionData.query.getMessagesByType('user');
const assistantMessages = sessionData.query.getMessagesByType('assistant');

// Get the conversation chain
const chain = sessionData.query.getConversationChain(messageUuid);

// Search messages
const results = sessionData.query.searchMessages('keyword');
```

### Tool Use Analysis

```typescript
// Get all tool uses
const toolUses = sessionData.query.getAllToolUses();

// Query by tool name
const readFileUses = sessionData.query.getToolUsesByName('read_file');

// Analyze tool use patterns
const patterns = sessionData.analyzer.analyzeToolUsagePatterns();
patterns.forEach(pattern => {
  console.log(`Tool: ${pattern.toolName}`);
  console.log(`Usage count: ${pattern.usageCount}`);
  console.log(`Success rate: ${pattern.successRate}%`);
});
```

### Session Analysis

```typescript
// Analyze the conversation flow
const flow = sessionData.analyzer.analyzeConversationFlow();
console.log(`Main branch message count: ${flow.mainBranchFlow.messageCount}`);
console.log(`Average response time: ${flow.mainBranchFlow.averageResponseTime}ms`);

// Analyze branch usage
const branchAnalysis = sessionData.analyzer.analyzeBranchUsage();
console.log(`Total branches: ${branchAnalysis.totalBranches}`);
console.log(`Active branches: ${branchAnalysis.activeBranches}`);
```

### Data Export

```typescript
// Export as JSON
const json = sessionData.exporter.toJSON();

// Export as Markdown
const markdown = sessionData.exporter.toMarkdown();

// Export as graph data
const graph = sessionData.exporter.toGraphData();

// Export as DOT format (for Graphviz)
const dot = sessionData.exporter.toDOT();
```

## Architecture

### Core Classes

#### SessionDataImpl
The core implementation class for session data, responsible for:
- Storing all messages, Agents, tool uses, and other data
- Building message relationships (parent-child chains, branch trees)
- Maintaining timeline ordering
- Providing the basic query interface

#### JsonlParser
A three-phase JSONL parser:
1. **Phase one**: parse the JSONL line by line and collect all entries
2. **Phase two**: build message relationships, branch trees, and the timeline
3. **Phase three**: compute statistics and validate data integrity

#### SessionDataQuery
An advanced query interface that provides:
- Main branch / sidechain message queries
- Agent message filtering
- Conversation chain tracking
- Streaming fragment merging
- Tool use queries
- Time range filtering
- Full-text search

#### SessionDataExporter
A multi-format exporter that supports:
- JSON: the complete data structure
- CSV: tabular data
- Markdown: highly readable documents
- Graph: node-edge graph data
- DOT: Graphviz visualization format

#### SessionAnalyzer
A session analyzer that provides:
- Conversation flow analysis (message count, response time, input patterns)
- Tool use patterns (usage frequency, success rate, average duration)
- Branch usage statistics (branch count, depth, activity)
- Content replacement patterns (replacement frequency, type distribution)

### Data Types

Supports 22 JSONL Entry type combinations:

**TranscriptMessage types** (4):
- `user` - user message
- `assistant` - assistant message
- `attachment` - attachment message
- `system` - system message

**Metadata types** (7):
- `custom-title` - custom title
- `ai-title` - AI-generated title
- `tag` - tag
- `agent-name` - Agent name
- `mode` - mode (plan/act)
- `worktree-state` - worktree state
- `pr-link` - PR link

**Other types** (11):
- `agent` - Agent definition
- `tool-use` - tool call
- `tool-result` - tool result
- `replacement` - content replacement
- `error` - error information
- `checkpoint` - checkpoint
- `feedback` - feedback
- `cost` - cost record
- `model-change` - model switch
- `session-start` - session start
- `session-end` - session end

### Key Concepts

#### Message Relationships
- **parentUuid**: the UUID pointing to the parent message, used to build the conversation chain
- **isSidechain**: indicates whether the message is a sidechain message
- **agentId**: the associated Agent ID, used for branch tracking

#### Streaming Responses
- Multiple Entries may share the same `message.id` but have different `uuid` values
- Use `getStreamFragments()` to obtain all fragments
- Use `mergeStreamFragments()` to merge them into a complete message

#### Branch Management
- **Main branch**: `isSidechain = false` and no `agentId`
- **Agent branch**: messages that have an `agentId`
- **Sidechain**: messages where `isSidechain = true`

## API Documentation

### SessionData

```typescript
interface SessionData {
  // Data storage
  messages: Map<string, TranscriptMessageEntry>;
  agents: Map<string, AgentEntry>;
  toolUses: Map<string, ToolUseEntry>;
  toolResults: Map<string, ToolResultEntry>;
  replacements: Map<string, ReplacementEntry>;
  
  // Relationship mappings
  messageIdToUuids: Map<string, string[]>;
  parentToChildren: Map<string, string[]>;
  messageToReplacements: Map<string, string[]>;
  
  // Timeline
  timeline: string[];
  
  // Query interfaces
  query: SessionDataQuery;
  exporter: SessionDataExporter;
  analyzer: SessionAnalyzer;
  
  // Basic methods
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
  // Branch queries
  getMainBranchMessages(): TranscriptMessageEntry[];
  getAgentMessages(agentId: string): TranscriptMessageEntry[];
  getAllBranches(): Map<string, TranscriptMessageEntry[]>;
  getBranchTree(): BranchNode;
  
  // Conversation chain
  getConversationChain(messageUuid: string): TranscriptMessageEntry[];
  
  // Streaming responses
  getStreamFragments(messageId: string): TranscriptMessageEntry[];
  mergeStreamFragments(messageId: string): TranscriptMessageEntry | null;
  
  // Tool queries
  getAllToolUses(): ToolUseEntry[];
  getToolUsesByName(toolName: string): ToolUseEntry[];
  getMessagesUsingTool(toolName: string): TranscriptMessageEntry[];
  
  // Statistics
  getStatistics(): SessionStatistics;
  getTimeline(): TimelineEntry[];
  
  // Search and filtering
  searchMessages(query: string): TranscriptMessageEntry[];
  getMessagesByType(type: TranscriptMessageType): TranscriptMessageEntry[];
  getMessagesInTimeRange(start: Date, end: Date): TranscriptMessageEntry[];
}
```

### SessionAnalyzer

```typescript
interface SessionAnalyzer {
  // Conversation flow analysis
  analyzeConversationFlow(): ConversationFlow;
  
  // Tool use analysis
  analyzeToolUsagePatterns(): ToolUsagePattern[];
  
  // Branch usage analysis
  analyzeBranchUsage(): BranchUsageAnalysis;
  
  // Replacement pattern analysis
  analyzeReplacementPatterns(): ReplacementPattern[];
}
```

## Testing

Run the test suite:

```bash
npm test
```

Run the example code:

```bash
npm run example
```

Test coverage:
- ✅ JSONL parsing (all 22 types)
- ✅ Message relationship construction
- ✅ Branch tree construction
- ✅ Timeline ordering
- ✅ Query features
- ✅ Tool use analysis
- ✅ Session analysis
- ✅ Data export
- ✅ Streaming response handling
- ✅ Search and filtering

## Project Structure

```
ClaudeCodeStructure/
├── src/
│   ├── types.ts              # All type definitions (22 Entry types)
│   ├── SessionData.ts        # Core data structure implementation
│   ├── SessionDataQuery.ts   # Query interface implementation
│   ├── SessionDataExporter.ts # Export feature implementation
│   ├── SessionAnalyzer.ts    # Analysis feature implementation
│   ├── JsonlParser.ts        # JSONL parser
│   └── index.ts              # Main entry file
├── tests/
│   ├── sample.jsonl          # Test data (24 records)
│   ├── test.ts               # Test suite (17 test cases)
│   └── example.ts            # Usage examples (10 examples)
├── package.json
├── tsconfig.json
└── README.md
```

## License

MIT

## Contributing

Issues and Pull Requests are welcome!
