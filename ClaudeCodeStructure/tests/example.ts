/**
 * Example usage of the Claude Code JSONL Parser
 * 
 * This file demonstrates how to use the parser to analyze Claude Code session data
 */

import { parseSessionFile, parseSessionContent } from '../src/index';
import { SessionDataQuery } from '../src/SessionDataQuery';
import { SessionDataExporter } from '../src/SessionDataExporter';
import { SessionAnalyzer } from '../src/SessionAnalyzer';
import * as path from 'path';

// Example 1: Parse a JSONL file
async function example1_parseFile() {
  console.log('\n=== Example 1: Parse JSONL File ===');
  
  const filePath = path.join(__dirname, 'a3d0cc87-cbb3-450a-be14-e3d86f4b12ba.jsonl');
  const sessionData = await parseSessionFile(filePath);
  
  console.log(`Total messages: ${sessionData.messages.size}`);
  console.log(`Total tool uses: ${sessionData.toolUses.size}`);
  console.log(`Session title: ${sessionData.title || 'Untitled'}`);
  console.log(`Session mode: ${sessionData.mode || 'Unknown'}`);
  console.log(`Tags: ${sessionData.tags.join(', ') || 'None'}`);
}

// Example 2: Query messages
async function example2_queryMessages() {
  console.log('\n=== Example 2: Query Messages ===');
  
  const filePath = path.join(__dirname, 'a3d0cc87-cbb3-450a-be14-e3d86f4b12ba.jsonl');
  const sessionData = await parseSessionFile(filePath);
  const query = new SessionDataQuery(sessionData);
  
  // Get main branch messages only
  const mainMessages = query.getMainBranchMessages();
  console.log(`Main branch messages: ${mainMessages.length}`);
  
  // Get messages by type
  const userMessages = query.getMessagesByType('user');
  const assistantMessages = query.getMessagesByType('assistant');
  console.log(`User messages: ${userMessages.length}`);
  console.log(`Assistant messages: ${assistantMessages.length}`);
  
  // Get conversation chain from a specific message
  if (mainMessages.length > 0) {
    const firstMessage = mainMessages[0];
    const chain = query.getConversationChain(firstMessage.uuid);
    console.log(`Conversation chain depth: ${chain.depth}`);
    console.log(`Conversation chain messages: ${chain.messages.length}`);
  }
}

// Example 3: Analyze tool usage
async function example3_analyzeTools() {
  console.log('\n=== Example 3: Analyze Tool Usage ===');
  
  const filePath = path.join(__dirname, 'a3d0cc87-cbb3-450a-be14-e3d86f4b12ba.jsonl');
  const sessionData = await parseSessionFile(filePath);
  const analyzer = new SessionAnalyzer(sessionData);
  
  const toolPatterns = analyzer.analyzeToolUsagePatterns();
  
  console.log('\nTool Usage Patterns:');
  for (const pattern of toolPatterns) {
    console.log(`  ${pattern.toolName}:`);
    console.log(`    Usage count: ${pattern.usageCount}`);
    console.log(`    Success rate: ${(pattern.successRate * 100).toFixed(1)}%`);
    console.log(`    Avg execution time: ${pattern.averageExecutionTime.toFixed(0)}ms`);
  }
}

// Example 4: Export data
async function example4_exportData() {
  console.log('\n=== Example 4: Export Data ===');
  
  const filePath = path.join(__dirname, 'a3d0cc87-cbb3-450a-be14-e3d86f4b12ba.jsonl');
  const sessionData = await parseSessionFile(filePath);
  const exporter = new SessionDataExporter(sessionData);
  
  // Export to JSON
  const jsonData = exporter.toJSON();
  console.log(`JSON export: ${JSON.stringify(jsonData).length} characters`);
  
  // Export to Markdown
  const markdown = exporter.toMarkdown();
  console.log(`Markdown export: ${markdown.split('\n').length} lines`);
  
  // Export to graph data
  const graphData = exporter.toGraphData();
  console.log(`Graph nodes: ${graphData.nodes.length}`);
  console.log(`Graph edges: ${graphData.edges.length}`);
}

// Example 5: Analyze conversation flow
async function example5_analyzeConversation() {
  console.log('\n=== Example 5: Analyze Conversation Flow ===');
  
  const filePath = path.join(__dirname, 'a3d0cc87-cbb3-450a-be14-e3d86f4b12ba.jsonl');
  const sessionData = await parseSessionFile(filePath);
  const analyzer = new SessionAnalyzer(sessionData);
  
  const flowAnalysis = analyzer.analyzeConversationFlow();
  
  console.log(`Main branch messages: ${flowAnalysis.mainBranchFlow.messageCount}`);
  console.log(`Main branch avg response time: ${flowAnalysis.mainBranchFlow.averageResponseTime.toFixed(0)}ms`);
  console.log(`Main branch tool usage rate: ${(flowAnalysis.mainBranchFlow.toolUsageRate * 100).toFixed(1)}%`);
  console.log(`Total branches: ${flowAnalysis.branchFlows.length}`);
}

// Example 6: Parse from string content
async function example6_parseContent() {
  console.log('\n=== Example 6: Parse from String Content ===');
  
  const jsonlContent = `
{"type":"metadata","key":"custom-title","value":"Test Session"}
{"type":"message","uuid":"msg-1","message":{"id":"1","role":"user","content":[{"type":"text","text":"Hello"}]},"timestamp":1000}
{"type":"message","uuid":"msg-2","message":{"id":"2","role":"assistant","content":[{"type":"text","text":"Hi there!"}]},"timestamp":2000,"parentUuid":"msg-1"}
  `.trim();
  
  const sessionData = await parseSessionContent(jsonlContent);
  
  console.log(`Parsed ${sessionData.messages.size} messages from string`);
  console.log(`Session title: ${sessionData.title}`);
}

// Example 7: Working with branches
async function example7_analyzeBranches() {
  console.log('\n=== Example 7: Analyze Branches ===');
  
  const filePath = path.join(__dirname, 'a3d0cc87-cbb3-450a-be14-e3d86f4b12ba.jsonl');
  const sessionData = await parseSessionFile(filePath);
  const analyzer = new SessionAnalyzer(sessionData);
  
  const branchAnalysis = analyzer.analyzeBranchUsage();
  
  console.log(`Total branches: ${branchAnalysis.totalBranches}`);
  console.log(`Average branch depth: ${branchAnalysis.averageBranchDepth.toFixed(1)}`);
  console.log(`Branch merge rate: ${(branchAnalysis.branchMergeRate * 100).toFixed(1)}%`);
  
  console.log('\nBranch details:');
  for (const branch of branchAnalysis.branchDetails) {
    console.log(`  ${branch.name || branch.agentId}:`);
    console.log(`    Depth: ${branch.depth}`);
    console.log(`    Messages: ${branch.messageCount}`);
    console.log(`    Tool uses: ${branch.toolUseCount}`);
    console.log(`    Merged: ${branch.merged ? 'Yes' : 'No'}`);
  }
}

// Example 8: Get session statistics
async function example8_getStatistics() {
  console.log('\n=== Example 8: Session Statistics ===');
  
  const filePath = path.join(__dirname, 'a3d0cc87-cbb3-450a-be14-e3d86f4b12ba.jsonl');
  const sessionData = await parseSessionFile(filePath);
  const query = new SessionDataQuery(sessionData);
  
  const stats = query.getStatistics();
  
  console.log(`Total messages: ${stats.totalMessages}`);
  console.log(`  User: ${stats.messagesByType.user}`);
  console.log(`  Assistant: ${stats.messagesByType.assistant}`);
  console.log(`  System: ${stats.messagesByType.system}`);
  console.log(`  Attachment: ${stats.messagesByType.attachment}`);
  console.log(`Total tool uses: ${stats.totalToolUses}`);
  console.log(`Total agents: ${stats.totalAgents}`);
  console.log(`Total branches: ${stats.totalBranches}`);
  console.log(`Total replacements: ${stats.totalReplacements}`);
  console.log(`Total tokens: ${stats.totalTokens.input + stats.totalTokens.output}`);
  console.log(`  Input: ${stats.totalTokens.input}`);
  console.log(`  Output: ${stats.totalTokens.output}`);
  console.log(`Session duration: ${Math.round(stats.timeRange.duration / 1000)}s`);
}

// Example 9: Stream fragment handling
async function example9_streamFragments() {
  console.log('\n=== Example 9: Stream Fragment Handling ===');
  
  const filePath = path.join(__dirname, 'a3d0cc87-cbb3-450a-be14-e3d86f4b12ba.jsonl');
  const sessionData = await parseSessionFile(filePath);
  const query = new SessionDataQuery(sessionData);
  
  // Find a message with multiple fragments
  for (const [messageId, uuids] of sessionData.messagesByMessageId) {
    if (uuids.length > 1) {
      console.log(`\nMessage ID ${messageId} has ${uuids.length} fragments`);
      
      const fragments = query.getStreamFragments(messageId);
      console.log(`Fragment timestamps:`);
      for (const fragment of fragments) {
        console.log(`  Fragment ${fragment.fragmentIndex}: ${fragment.timestamp}ms`);
      }
      
      const merged = query.mergeStreamFragments(messageId);
      console.log(`Merged content blocks: ${merged.mergedContent.length}`);
      break;
    }
  }
}

// Example 10: Search and filter
async function example10_searchAndFilter() {
  console.log('\n=== Example 10: Search and Filter ===');
  
  const filePath = path.join(__dirname, 'a3d0cc87-cbb3-450a-be14-e3d86f4b12ba.jsonl');
  const sessionData = await parseSessionFile(filePath);
  const query = new SessionDataQuery(sessionData);
  
  // Search messages
  const searchResults = query.searchMessages('file');
  console.log(`Messages containing "file": ${searchResults.length}`);
  
  // Get messages using specific tool
  const readFileMessages = query.getMessagesUsingTool('read_file');
  console.log(`Messages using read_file: ${readFileMessages.length}`);
  
  // Get tool uses by name
  const writeToolUses = query.getToolUsesByName('write_to_file');
  console.log(`write_to_file uses: ${writeToolUses.length}`);
}

// Example 11: Export context chains to file
async function example11_exportContextChains() {
  console.log('\n=== Example 11: Export Context Chains to File ===');
  
  const filePath = path.join(__dirname, 'a3d0cc87-cbb3-450a-be14-e3d86f4b12ba.jsonl');
  const sessionData = await parseSessionFile(filePath);
  const exporter = new SessionDataExporter(sessionData);
  
  // Export context chains to a JSON file
  const outputPath = path.join(__dirname, 'output', 'context-chains.json');
  await exporter.exportContextChainsToFile(outputPath);
  
  console.log(`Context chains exported to: ${outputPath}`);
  console.log(`Total messages: ${sessionData.messages.size}`);
  
  // You can also get the JSON string directly without writing to file
  const contextChainsJson = exporter.exportContextChains();
  const contextChains = JSON.parse(contextChainsJson);
  
  // Show some example chains
  const exampleUuids = Array.from(sessionData.messages.keys()).slice(0, 3);
  console.log('\nExample context chains:');
  for (const uuid of exampleUuids) {
    const chain = contextChains[uuid];
    console.log(`  ${uuid}:`);
    console.log(`    Chain length: ${chain.length}`);
    console.log(`    Chain: ${chain.join(' -> ')}`);
  }
}

// Run all examples
async function runAllExamples() {
  try {
    await example1_parseFile();
    await example2_queryMessages();
    await example3_analyzeTools();
    await example4_exportData();
    await example5_analyzeConversation();
    await example6_parseContent();
    await example7_analyzeBranches();
    await example8_getStatistics();
    await example9_streamFragments();
    await example10_searchAndFilter();
    await example11_exportContextChains();
    
    console.log('\n✅ All examples completed successfully!');
  } catch (error) {
    console.error('❌ Error running examples:', error);
    process.exit(1);
  }
}

// Run examples if this file is executed directly
if (require.main === module) {
  runAllExamples();
}