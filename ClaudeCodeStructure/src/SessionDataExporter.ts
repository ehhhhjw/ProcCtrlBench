import { SessionDataImpl } from './SessionData';
import { GraphData, GraphNode, GraphEdge } from './types';
import * as fs from 'fs';
import * as path from 'path';

/**
 * SessionDataExporter - Export session data to various formats
 */
export class SessionDataExporter {
  constructor(private sessionData: SessionDataImpl) {}

  /**
   * Export to JSON format
   */
  toJSON(): string {
    const data = {
      metadata: {
        title: this.sessionData.title,
        tags: this.sessionData.tags,
        mode: this.sessionData.mode,
        prLinks: this.sessionData.prLinks,
      },
      statistics: this.sessionData.statistics,
      messages: Array.from(this.sessionData.messages.values()),
      agents: Array.from(this.sessionData.agents.values()),
      branchTree: {
        mainBranch: this.sessionData.branchTree.mainBranch,
        branches: Array.from(this.sessionData.branchTree.branches.entries()),
      },
      toolUses: Array.from(this.sessionData.toolUses.values()),
      toolResults: Array.from(this.sessionData.toolResults.values()),
      replacements: Array.from(this.sessionData.replacements.values()),
      timeline: this.sessionData.timeline,
    };

    return JSON.stringify(data, null, 2);
  }

  /**
   * Export to CSV format (messages only)
   */
  toCSV(): string {
    const headers = [
      'UUID',
      'Message ID',
      'Type',
      'Timestamp',
      'Content',
      'Parent UUID',
      'Agent ID',
      'Is Sidechain',
      'Model',
      'Input Tokens',
      'Output Tokens',
    ];

    const rows = [headers.join(',')];

    for (const message of this.sessionData.messages.values()) {
      const contentBlocks = Array.isArray(message.content)
        ? message.content
        : [{ type: 'text' as const, text: message.content }];
      
      const content = contentBlocks
        .map(block => {
          if (block.type === 'text') return block.text;
          return `[${block.type}]`;
        })
        .join(' ')
        .replace(/"/g, '""')
        .replace(/\n/g, ' ');

      const row = [
        message.uuid,
        message.messageId,
        message.type,
        new Date(message.timestamp).toISOString(),
        `"${content}"`,
        message.parentUuid || '',
        message.agentId || '',
        message.isSidechain ? 'true' : 'false',
        message.model || '',
        message.usage?.input_tokens || '',
        message.usage?.output_tokens || '',
      ];

      rows.push(row.join(','));
    }

    return rows.join('\n');
  }

  /**
   * Export to Markdown format
   */
  toMarkdown(): string {
    const lines: string[] = [];

    // Title
    lines.push(`# Session: ${this.sessionData.title || 'Untitled'}\n`);

    // Metadata
    lines.push('## Metadata\n');
    lines.push(`- **Tags**: ${this.sessionData.tags.join(', ') || 'None'}`);
    lines.push(`- **Mode**: ${this.sessionData.mode || 'Unknown'}`);
    if (this.sessionData.prLinks.length > 0) {
      lines.push(`- **PR Links**: ${this.sessionData.prLinks.map(pr => `[#${pr.number}](${pr.url})`).join(', ')}`);
    }
    lines.push('');

    // Statistics
    lines.push('## Statistics\n');
    lines.push(`- **Total Messages**: ${this.sessionData.statistics.totalMessages}`);
    lines.push(`  - User: ${this.sessionData.statistics.messagesByType.user}`);
    lines.push(`  - Assistant: ${this.sessionData.statistics.messagesByType.assistant}`);
    lines.push(`  - System: ${this.sessionData.statistics.messagesByType.system}`);
    lines.push(`- **Total Tool Uses**: ${this.sessionData.statistics.totalToolUses}`);
    lines.push(`- **Total Agents**: ${this.sessionData.statistics.totalAgents}`);
    lines.push(`- **Total Branches**: ${this.sessionData.statistics.totalBranches}`);
    lines.push(`- **Total Tokens**: ${this.sessionData.statistics.totalTokens.input + this.sessionData.statistics.totalTokens.output}`);
    lines.push(`  - Input: ${this.sessionData.statistics.totalTokens.input}`);
    lines.push(`  - Output: ${this.sessionData.statistics.totalTokens.output}`);
    lines.push('');

    // Tool Usage
    if (Object.keys(this.sessionData.statistics.toolUsesByName).length > 0) {
      lines.push('## Tool Usage\n');
      for (const [toolName, count] of Object.entries(this.sessionData.statistics.toolUsesByName)) {
        lines.push(`- **${toolName}**: ${count} uses`);
      }
      lines.push('');
    }

    // Conversation Timeline
    lines.push('## Conversation Timeline\n');
    const messages = Array.from(this.sessionData.messages.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    for (const message of messages) {
      const time = new Date(message.timestamp).toISOString();
      const agentLabel = message.agentId ? ` [Agent: ${message.agentId}]` : '';
      const branchLabel = message.isSidechain ? ' [Branch]' : '';
      
      lines.push(`### ${message.type.toUpperCase()}${agentLabel}${branchLabel}`);
      lines.push(`*${time}*\n`);

      const contentBlocks = Array.isArray(message.content)
        ? message.content
        : [{ type: 'text' as const, text: message.content }];

      for (const block of contentBlocks) {
        if (block.type === 'text') {
          lines.push(block.text);
        } else if (block.type === 'tool_use') {
          lines.push(`**Tool Use**: ${block.name}`);
          lines.push('```json');
          lines.push(JSON.stringify(block.input, null, 2));
          lines.push('```');
        } else if (block.type === 'tool_result') {
          lines.push(`**Tool Result**: ${typeof block.content === 'string' ? block.content : '[Complex Result]'}`);
        }
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Export to graph data format (for visualization)
   */
  toGraphData(): GraphData {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // Add message nodes
    for (const message of this.sessionData.messages.values()) {
      nodes.push({
        id: message.uuid,
        label: `${message.type}: ${message.messageId.substring(0, 8)}`,
        type: 'message',
        data: message,
      });

      // Add parent-child edges
      if (message.parentUuid) {
        edges.push({
          source: message.parentUuid,
          target: message.uuid,
          type: 'parent-child',
        });
      }
    }

    // Add agent nodes
    for (const agent of this.sessionData.agents.values()) {
      nodes.push({
        id: `agent-${agent.agentId}`,
        label: agent.name || agent.agentId,
        type: 'agent',
        data: agent,
      });

      // Add edges from agent to its messages
      for (const messageUuid of agent.messageUuids) {
        edges.push({
          source: `agent-${agent.agentId}`,
          target: messageUuid,
          type: 'branch',
          label: 'owns',
        });
      }
    }

    // Add tool nodes and edges
    for (const toolUse of this.sessionData.toolUses.values()) {
      nodes.push({
        id: `tool-${toolUse.id}`,
        label: toolUse.name,
        type: 'tool',
        data: toolUse,
      });

      // Edge from message to tool use
      const messages = this.sessionData.getMessagesByMessageId(toolUse.messageId);
      for (const message of messages) {
        edges.push({
          source: message.uuid,
          target: `tool-${toolUse.id}`,
          type: 'tool-use',
        });
      }

      // Edge from tool use to result
      if (toolUse.hasResult && toolUse.resultUuid) {
        edges.push({
          source: `tool-${toolUse.id}`,
          target: toolUse.resultUuid,
          type: 'tool-result',
        });
      }
    }

    return { nodes, edges };
  }

  /**
   * Export to DOT format (for Graphviz)
   */
  toDOT(): string {
    const lines: string[] = [];
    lines.push('digraph SessionGraph {');
    lines.push('  rankdir=TB;');
    lines.push('  node [shape=box];');
    lines.push('');

    // Add nodes
    for (const message of this.sessionData.messages.values()) {
      const label = `${message.type}\\n${new Date(message.timestamp).toISOString()}`;
      const color = message.isSidechain ? 'lightblue' : 'white';
      lines.push(`  "${message.uuid}" [label="${label}", fillcolor="${color}", style=filled];`);
    }

    lines.push('');

    // Add edges
    for (const message of this.sessionData.messages.values()) {
      if (message.parentUuid) {
        lines.push(`  "${message.parentUuid}" -> "${message.uuid}";`);
      }
    }

    lines.push('}');
    return lines.join('\n');
  }

  /**
   * Export context chains for all messages (post-compression state)
   * Returns a JSON mapping of UUID -> ordered array of ancestor UUIDs
   * 
   * This method uses the compressed/runtime state (Option B), meaning:
   * - Only messages that exist in the runtime messages Map are included
   * - Context compression (snip removals, preserved segment relinks, marble-origami) is already applied
   * - Each UUID maps to an array of UUIDs representing the context chain from root to current message
   * 
   * @returns JSON string with format: { "uuid": ["root-uuid", "parent-uuid", ..., "uuid"], ... }
   */
  exportContextChains(): string {
    const contextChains: Record<string, string[]> = {};
    
    // Traverse all messages in post-compression state
    for (const [uuid, message] of this.sessionData.messages.entries()) {
      const chain: string[] = [];
      let currentUuid: string | undefined = uuid;
      
      // Build chain by traversing parentUuid backwards to root
      while (currentUuid) {
        chain.unshift(currentUuid); // Add to front to maintain order from root to current
        const currentMessage = this.sessionData.messages.get(currentUuid);
        currentUuid = currentMessage?.parentUuid || undefined;
      }
      
      contextChains[uuid] = chain;
    }
    
    return JSON.stringify(contextChains, null, 2);
  }

  /**
   * Export context chains to a JSON file
   * Writes the context chains mapping to the specified file path
   * 
   * @param outputPath - The file path where the JSON file will be written
   * @returns Promise that resolves when the file is written successfully
   */
  async exportContextChainsToFile(outputPath: string): Promise<void> {
    const contextChainsJson = this.exportContextChains();
    
    // Ensure the directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Write to file
    await fs.promises.writeFile(outputPath, contextChainsJson, 'utf-8');
  }
}