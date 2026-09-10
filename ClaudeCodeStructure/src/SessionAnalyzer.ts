import { SessionDataImpl } from './SessionData';
import { SessionDataQuery } from './SessionDataQuery';
import {
  ConversationFlow,
  ToolUsagePattern,
  BranchUsageAnalysis,
  ReplacementPattern,
} from './types';

/**
 * SessionAnalyzer - Advanced analysis of session data
 */
export class SessionAnalyzer {
  private query: SessionDataQuery;

  constructor(private sessionData: SessionDataImpl) {
    this.query = new SessionDataQuery(sessionData);
  }

  /**
   * Analyze conversation flow
   */
  analyzeConversationFlow(): ConversationFlow {
    const mainMessages = this.query.getMainBranchMessages();
    const mainToolUses = Array.from(this.sessionData.toolUses.values())
      .filter(t => !t.agentId);

    const mainBranchFlow = {
      messageCount: mainMessages.length,
      averageResponseTime: this.calculateAverageResponseTime(mainMessages),
      toolUsageRate: mainMessages.length > 0 ? mainToolUses.length / mainMessages.length : 0,
    };

    const branchFlows = Array.from(this.sessionData.agents.values()).map(agent => {
      const messages = this.query.getAgentMessages(agent.agentId);
      const toolUses = Array.from(this.sessionData.toolUses.values())
        .filter(t => t.agentId === agent.agentId);

      return {
        agentId: agent.agentId,
        name: agent.name,
        messageCount: messages.length,
        toolUsageRate: messages.length > 0 ? toolUses.length / messages.length : 0,
        mergedToMain: this.query.isBranchMergedToMain(agent.agentId),
      };
    });

    return {
      mainBranchFlow,
      branchFlows,
    };
  }

  /**
   * Analyze tool usage patterns
   */
  analyzeToolUsagePatterns(): ToolUsagePattern[] {
    const toolGroups = new Map<string, typeof this.sessionData.toolUses extends Map<any, infer V> ? V[] : never>();

    // Group tool uses by name
    for (const toolUse of this.sessionData.toolUses.values()) {
      if (!toolGroups.has(toolUse.name)) {
        toolGroups.set(toolUse.name, []);
      }
      toolGroups.get(toolUse.name)!.push(toolUse);
    }

    const patterns: ToolUsagePattern[] = [];

    for (const [toolName, uses] of toolGroups) {
      const successCount = uses.filter(u => {
        const result = this.sessionData.getToolResult(u.id);
        return result && !result.is_error;
      }).length;

      const executionTimes: number[] = [];
      for (const use of uses) {
        const result = this.sessionData.getToolResult(use.id);
        if (result) {
          executionTimes.push(result.timestamp - use.timestamp);
        }
      }

      const averageExecutionTime = executionTimes.length > 0
        ? executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length
        : 0;

      // Analyze input patterns
      const inputPatterns = this.analyzeInputPatterns(uses);

      // Analyze error patterns
      const errorPatterns = this.analyzeErrorPatterns(uses);

      patterns.push({
        toolName,
        usageCount: uses.length,
        successRate: uses.length > 0 ? successCount / uses.length : 0,
        averageExecutionTime,
        commonInputPatterns: inputPatterns,
        errorPatterns,
      });
    }

    return patterns.sort((a, b) => b.usageCount - a.usageCount);
  }

  /**
   * Analyze branch usage
   */
  analyzeBranchUsage(): BranchUsageAnalysis {
    const branches = this.query.getAllBranches();
    const branchDetails = branches.map(agent => {
      const messages = this.query.getAgentMessages(agent.agentId);
      const toolUses = Array.from(this.sessionData.toolUses.values())
        .filter(t => t.agentId === agent.agentId);
      
      const branchNode = this.sessionData.branchTree.branches.get(agent.agentId);
      const depth = branchNode?.depth || 0;

      return {
        agentId: agent.agentId,
        name: agent.name,
        depth,
        messageCount: messages.length,
        toolUseCount: toolUses.length,
        merged: this.query.isBranchMergedToMain(agent.agentId),
      };
    });

    const totalDepth = branchDetails.reduce((sum, b) => sum + b.depth, 0);
    const mergedCount = branchDetails.filter(b => b.merged).length;

    return {
      totalBranches: branches.length,
      averageBranchDepth: branches.length > 0 ? totalDepth / branches.length : 0,
      branchMergeRate: branches.length > 0 ? mergedCount / branches.length : 0,
      branchDetails,
    };
  }

  /**
   * Analyze replacement patterns
   */
  analyzeReplacementPatterns(): ReplacementPattern[] {
    const toolGroups = new Map<string, typeof this.sessionData.replacements extends Map<any, infer V> ? V[] : never>();

    // Group replacements by tool
    for (const replacement of this.sessionData.replacements.values()) {
      const toolUse = this.sessionData.getToolUse(replacement.toolUseId);
      if (toolUse) {
        if (!toolGroups.has(toolUse.name)) {
          toolGroups.set(toolUse.name, []);
        }
        toolGroups.get(toolUse.name)!.push(replacement);
      }
    }

    const patterns: ReplacementPattern[] = [];

    for (const [toolName, replacements] of toolGroups) {
      const totalSize = replacements.reduce(
        (sum, r) => sum + r.replacementContent.length,
        0
      );

      // Count reasons
      const reasonCounts = new Map<string, number>();
      for (const replacement of replacements) {
        if (replacement.reason) {
          reasonCounts.set(
            replacement.reason,
            (reasonCounts.get(replacement.reason) || 0) + 1
          );
        }
      }

      const commonReasons = Array.from(reasonCounts.entries())
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count);

      patterns.push({
        toolName,
        replacementCount: replacements.length,
        averageReplacementSize: replacements.length > 0 ? totalSize / replacements.length : 0,
        commonReasons,
      });
    }

    return patterns.sort((a, b) => b.replacementCount - a.replacementCount);
  }

  /**
   * Calculate average response time between messages
   */
  private calculateAverageResponseTime(messages: typeof this.sessionData.messages extends Map<any, infer V> ? V[] : never): number {
    if (messages.length < 2) return 0;

    const sortedMessages = [...messages].sort((a, b) => a.timestamp - b.timestamp);
    const timeDiffs: number[] = [];

    for (let i = 1; i < sortedMessages.length; i++) {
      timeDiffs.push(sortedMessages[i].timestamp - sortedMessages[i - 1].timestamp);
    }

    return timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length;
  }

  /**
   * Analyze input patterns for tool uses
   */
  private analyzeInputPatterns(uses: typeof this.sessionData.toolUses extends Map<any, infer V> ? V[] : never): Array<{ pattern: string; count: number }> {
    const patternCounts = new Map<string, number>();

    for (const use of uses) {
      // Extract common input patterns
      const inputKeys = Object.keys(use.input).sort().join(',');
      patternCounts.set(inputKeys, (patternCounts.get(inputKeys) || 0) + 1);
    }

    return Array.from(patternCounts.entries())
      .map(([pattern, count]) => ({ pattern, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5); // Top 5 patterns
  }

  /**
   * Analyze error patterns for tool uses
   */
  private analyzeErrorPatterns(uses: typeof this.sessionData.toolUses extends Map<any, infer V> ? V[] : never): Array<{ error: string; count: number }> {
    const errorCounts = new Map<string, number>();

    for (const use of uses) {
      const result = this.sessionData.getToolResult(use.id);
      if (result && result.is_error) {
        let errorMessage = 'Unknown error';
        
        if (typeof result.content === 'string') {
          errorMessage = result.content.substring(0, 100); // First 100 chars
        } else if (Array.isArray(result.content)) {
          const textContent = result.content.find(c => c.type === 'text');
          if (textContent && 'text' in textContent) {
            errorMessage = textContent.text.substring(0, 100);
          }
        }

        errorCounts.set(errorMessage, (errorCounts.get(errorMessage) || 0) + 1);
      }
    }

    return Array.from(errorCounts.entries())
      .map(([error, count]) => ({ error, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5); // Top 5 errors
  }
}
