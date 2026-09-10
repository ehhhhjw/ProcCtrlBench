/**
 * Comprehensive Test Suite for Claude Code JSONL Parser
 */

import * as path from 'path';
import * as fs from 'fs';
import { JsonlParser } from '../src/JsonlParser';
import { SessionDataQuery } from '../src/SessionDataQuery';
import { SessionDataExporter } from '../src/SessionDataExporter';
import { SessionAnalyzer } from '../src/SessionAnalyzer';

// CommonJS __dirname is available in Node.js
declare const __dirname: string;
declare const process: {
  exit(code?: number): never;
};

async function runTests() {
  console.log('🧪 Starting Claude Code JSONL Parser Tests\n');
  
  let passedTests = 0;
  let failedTests = 0;

  // Helper function to run a test
  function test(name: string, fn: () => void | Promise<void>) {
    return async () => {
      try {
        await fn();
        console.log(`✅ ${name}`);
        passedTests++;
      } catch (error) {
        console.log(`❌ ${name}`);
        console.error(`   Error: ${error instanceof Error ? error.message : String(error)}`);
        failedTests++;
      }
    };
  }

  // Test 1: Parse JSONL file
  await test('Parse JSONL file', async () => {
    const parser = new JsonlParser();
    const samplePath = path.join(__dirname, '52cf5506-0240-40a9-a350-f613b4e886bb.jsonl');
    const sessionData = await parser.parseFile(samplePath);
    
    if (sessionData.messages.size === 0) {
      throw new Error('No messages parsed');
    }
    console.log(`   Parsed ${sessionData.messages.size} messages`);
  })();

  // Test 2: Verify message relationships
  await test('Verify message relationships', async () => {
    const parser = new JsonlParser();
    const samplePath = path.join(__dirname, '52cf5506-0240-40a9-a350-f613b4e886bb.jsonl');
    const sessionData = await parser.parseFile(samplePath);
    
    // Check that messages have parent-child relationships
    let hasChildren = false;
    for (const message of sessionData.messages.values()) {
      if (message.children.length > 0) {
        hasChildren = true;
        break;
      }
    }
    
    if (!hasChildren) {
      throw new Error('No parent-child relationships found');
    }
    console.log('   Parent-child relationships verified');
  })();

  // Test 3: Verify metadata parsing
  await test('Verify metadata parsing', async () => {
    const parser = new JsonlParser();
    const samplePath = path.join(__dirname, '52cf5506-0240-40a9-a350-f613b4e886bb.jsonl');
    const sessionData = await parser.parseFile(samplePath);
    
    if (!sessionData.title) {
      throw new Error('Title not parsed');
    }
    if (sessionData.tags.length === 0) {
      throw new Error('Tags not parsed');
    }
    if (!sessionData.mode) {
      throw new Error('Mode not parsed');
    }
    
    console.log(`   Title: ${sessionData.title}`);
    console.log(`   Tags: ${sessionData.tags.join(', ')}`);
    console.log(`   Mode: ${sessionData.mode}`);
  })();

  // Test 4: Verify tool use tracking
  await test('Verify tool use tracking', async () => {
    const parser = new JsonlParser();
    const samplePath = path.join(__dirname, '52cf5506-0240-40a9-a350-f613b4e886bb.jsonl');
    const sessionData = await parser.parseFile(samplePath);
    
    if (sessionData.toolUses.size === 0) {
      throw new Error('No tool uses found');
    }
    
    // Check that tool uses have results
    let hasResults = false;
    for (const toolUse of sessionData.toolUses.values()) {
      if (toolUse.hasResult) {
        hasResults = true;
        break;
      }
    }
    
    if (!hasResults) {
      throw new Error('No tool results found');
    }
    
    console.log(`   Found ${sessionData.toolUses.size} tool uses`);
    console.log(`   Found ${sessionData.toolResults.size} tool results`);
  })();

  // Test 5: Verify branch tracking
  await test('Verify branch tracking', async () => {
    const parser = new JsonlParser();
    const samplePath = path.join(__dirname, '52cf5506-0240-40a9-a350-f613b4e886bb.jsonl');
    const sessionData = await parser.parseFile(samplePath);
    
    if (sessionData.agents.size === 0) {
      throw new Error('No agents/branches found');
    }
    
    console.log(`   Found ${sessionData.agents.size} branches`);
    for (const agent of sessionData.agents.values()) {
      console.log(`   - ${agent.name || agent.agentId}: ${agent.messageUuids.length} messages`);
    }
  })();

  // Test 6: Query - Get main branch messages
  await test('Query: Get main branch messages', async () => {
    const parser = new JsonlParser();
    const samplePath = path.join(__dirname, '52cf5506-0240-40a9-a350-f613b4e886bb.jsonl');
    const sessionData = await parser.parseFile(samplePath);
    const query = new SessionDataQuery(sessionData);
    
    const mainMessages = query.getMainBranchMessages();
    if (mainMessages.length === 0) {
      throw new Error('No main branch messages found');
    }
    
    console.log(`   Found ${mainMessages.length} main branch messages`);
  })();

  // Test 7: Query - Get conversation chain
  await test('Query: Get conversation chain', async () => {
    const parser = new JsonlParser();
    const samplePath = path.join(__dirname, '52cf5506-0240-40a9-a350-f613b4e886bb.jsonl');
    const sessionData = await parser.parseFile(samplePath);
    const query = new SessionDataQuery(sessionData);
    
    const firstMessage = Array.from(sessionData.messages.values())[0];
    const chain = query.getConversationChain(firstMessage.uuid);
    
    if (chain.messages.length === 0) {
      throw new Error('No conversation chain found');
    }
    
    console.log(`   Chain depth: ${chain.depth}, messages: ${chain.messages.length}`);
  })();

  // Test 8: Query - Get stream fragments
  await test('Query: Get stream fragments', async () => {
    const parser = new JsonlParser();
    const samplePath = path.join(__dirname, '52cf5506-0240-40a9-a350-f613b4e886bb.jsonl');
    const sessionData = await parser.parseFile(samplePath);
    const query = new SessionDataQuery(sessionData);
    
    // Find messages and check for stream fragments
    let fragmentCount = 0;
    const messageIds = new Set<string>();
    for (const message of sessionData.messages.values()) {
      if (message.messageId) {
        messageIds.add(message.messageId);
      }
    }
    
    for (const messageId of messageIds) {
      const fragments = query.getStreamFragments(messageId);
      if (fragments.length > 1) {
        fragmentCount++;
      }
    }
    console.log(`   Found ${fragmentCount} messages with multiple fragments`);
  })();

  // Test 9: Export to JSON
  await test('Export: To JSON', async () => {
    const parser = new JsonlParser();
    const samplePath = path.join(__dirname, '52cf5506-0240-40a9-a350-f613b4e886bb.jsonl');
    const sessionData = await parser.parseFile(samplePath);
    const exporter = new SessionDataExporter(sessionData);
    
    const json = exporter.toJSON();
    const parsed = JSON.parse(json);
    if (!parsed.metadata || !parsed.messages) {
      throw new Error('Invalid JSON export structure');
    }
    
    console.log(`   Exported ${parsed.messages.length} messages to JSON`);
  })();

  // Test 10: Export to Markdown
  await test('Export: To Markdown', async () => {
    const parser = new JsonlParser();
    const samplePath = path.join(__dirname, '52cf5506-0240-40a9-a350-f613b4e886bb.jsonl');
    const sessionData = await parser.parseFile(samplePath);
    const exporter = new SessionDataExporter(sessionData);
    
    const markdown = exporter.toMarkdown();
    if (!markdown.includes('# Session:')) {
      throw new Error('Invalid Markdown export');
    }
    
    console.log(`   Exported to Markdown (${markdown.length} chars)`);
  })();

  // Test 11: Export to Graph Data
  await test('Export: To Graph Data', async () => {
    const parser = new JsonlParser();
    const samplePath = path.join(__dirname, '52cf5506-0240-40a9-a350-f613b4e886bb.jsonl');
    const sessionData = await parser.parseFile(samplePath);
    const exporter = new SessionDataExporter(sessionData);
    
    const graph = exporter.toGraphData();
    if (graph.nodes.length === 0 || graph.edges.length === 0) {
      throw new Error('Invalid graph data');
    }
    
    console.log(`   Graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
  })();

  // Test 12: Analyze conversation flow
  await test('Analyze: Conversation flow', async () => {
    const parser = new JsonlParser();
    const samplePath = path.join(__dirname, '52cf5506-0240-40a9-a350-f613b4e886bb.jsonl');
    const sessionData = await parser.parseFile(samplePath);
    const analyzer = new SessionAnalyzer(sessionData);
    
    const flow = analyzer.analyzeConversationFlow();
    console.log(`   Main branch: ${flow.mainBranchFlow.messageCount} messages`);
    console.log(`   Branches: ${flow.branchFlows.length}`);
  })();

  // Test 13: Analyze tool usage patterns
  await test('Analyze: Tool usage patterns', async () => {
    const parser = new JsonlParser();
    const samplePath = path.join(__dirname, '52cf5506-0240-40a9-a350-f613b4e886bb.jsonl');
    const sessionData = await parser.parseFile(samplePath);
    const analyzer = new SessionAnalyzer(sessionData);
    
    const patterns = analyzer.analyzeToolUsagePatterns();
    console.log(`   Found ${patterns.length} tool usage patterns`);
    for (const pattern of patterns) {
      console.log(`   - ${pattern.toolName}: ${pattern.usageCount} uses, ${(pattern.successRate * 100).toFixed(1)}% success`);
    }
  })();

  // Test 14: Analyze branch usage
  await test('Analyze: Branch usage', async () => {
    const parser = new JsonlParser();
    const samplePath = path.join(__dirname, '52cf5506-0240-40a9-a350-f613b4e886bb.jsonl');
    const sessionData = await parser.parseFile(samplePath);
    const analyzer = new SessionAnalyzer(sessionData);
    
    const branchAnalysis = analyzer.analyzeBranchUsage();
    console.log(`   Total branches: ${branchAnalysis.totalBranches}`);
    console.log(`   Average depth: ${branchAnalysis.averageBranchDepth.toFixed(2)}`);
    console.log(`   Merge rate: ${(branchAnalysis.branchMergeRate * 100).toFixed(1)}%`);
  })();

  // Test 15: Analyze replacement patterns
  await test('Analyze: Replacement patterns', async () => {
    const parser = new JsonlParser();
    const samplePath = path.join(__dirname, '52cf5506-0240-40a9-a350-f613b4e886bb.jsonl');
    const sessionData = await parser.parseFile(samplePath);
    const analyzer = new SessionAnalyzer(sessionData);
    
    const patterns = analyzer.analyzeReplacementPatterns();
    console.log(`   Found ${patterns.length} replacement patterns`);
    for (const pattern of patterns) {
      console.log(`   - ${pattern.toolName}: ${pattern.replacementCount} replacements`);
    }
  })();

  // Test 16: Verify statistics
  await test('Verify statistics', async () => {
    const parser = new JsonlParser();
    const samplePath = path.join(__dirname, '52cf5506-0240-40a9-a350-f613b4e886bb.jsonl');
    const sessionData = await parser.parseFile(samplePath);
    const query = new SessionDataQuery(sessionData);
    
    const stats = query.getStatistics();
    if (stats.totalMessages === 0) {
      throw new Error('No statistics calculated');
    }
    
    console.log(`   Total messages: ${stats.totalMessages}`);
    console.log(`   Total tool uses: ${stats.totalToolUses}`);
    console.log(`   Total agents: ${stats.totalAgents}`);
  })();

  // Test 17: Verify timeline
  await test('Verify timeline', async () => {
    const parser = new JsonlParser();
    const samplePath = path.join(__dirname, '52cf5506-0240-40a9-a350-f613b4e886bb.jsonl');
    const sessionData = await parser.parseFile(samplePath);
    
    if (sessionData.timeline.length === 0) {
      throw new Error('No timeline events found');
    }
    
    // Verify timeline is sorted
    for (let i = 1; i < sessionData.timeline.length; i++) {
      if (sessionData.timeline[i].timestamp < sessionData.timeline[i - 1].timestamp) {
        throw new Error('Timeline not sorted');
      }
    }
    
    console.log(`   Timeline has ${sessionData.timeline.length} events`);
  })();

  // Test 18: Export context chains
  await test('Export: Context chains', async () => {
    const parser = new JsonlParser();
    const samplePath = path.join(__dirname, '52cf5506-0240-40a9-a350-f613b4e886bb.jsonl');
    const sessionData = await parser.parseFile(samplePath);
    const exporter = new SessionDataExporter(sessionData);
    
    const contextChainsJson = exporter.exportContextChains();
    const contextChains = JSON.parse(contextChainsJson);
    
    // Verify structure
    if (typeof contextChains !== 'object' || contextChains === null) {
      throw new Error('Context chains should be an object');
    }
    
    // Verify each UUID has a chain
    const messageCount = sessionData.messages.size;
    const chainCount = Object.keys(contextChains).length;
    if (chainCount !== messageCount) {
      throw new Error(`Expected ${messageCount} chains, got ${chainCount}`);
    }
    
    // Verify chain structure and validity
    let validChains = 0;
    for (const [uuid, chain] of Object.entries(contextChains)) {
      // Each chain should be an array
      if (!Array.isArray(chain)) {
        throw new Error(`Chain for ${uuid} is not an array`);
      }
      
      // Chain should end with the UUID itself
      if (chain[chain.length - 1] !== uuid) {
        throw new Error(`Chain for ${uuid} does not end with itself`);
      }
      
      // Verify parent-child relationships in chain
      for (let i = 1; i < chain.length; i++) {
        const childUuid = chain[i];
        const parentUuid = chain[i - 1];
        const childMessage = sessionData.messages.get(childUuid);
        
        if (!childMessage) {
          throw new Error(`Message ${childUuid} not found in session data`);
        }
        
        if (childMessage.parentUuid !== parentUuid) {
          throw new Error(`Invalid chain: ${childUuid}'s parent should be ${parentUuid}, but is ${childMessage.parentUuid}`);
        }
      }
      
      validChains++;
    }
    
    console.log(`   Exported ${chainCount} context chains`);
    console.log(`   Validated ${validChains} chains`);
    
    // Show some example chains
    const exampleUuids = Array.from(sessionData.messages.keys()).slice(0, 3);
    for (const uuid of exampleUuids) {
      const chain = contextChains[uuid];
      console.log(`   - ${uuid}: chain length ${chain.length}`);
    }
  })();

  // Test 19: Export context chains to file
  await test('Export: Context chains to file', async () => {
    const parser = new JsonlParser();
    const samplePath = path.join(__dirname, '52cf5506-0240-40a9-a350-f613b4e886bb.jsonl');
    const sessionData = await parser.parseFile(samplePath);
    const exporter = new SessionDataExporter(sessionData);
    
    // Define output path
    const outputPath = path.join(__dirname, 'output', 'context-chains.json');
    
    // Export to file
    await exporter.exportContextChainsToFile(outputPath);
    
    // Verify file exists
    if (!fs.existsSync(outputPath)) {
      throw new Error('Context chains file was not created');
    }
    
    // Read and verify file content
    const fileContent = await fs.promises.readFile(outputPath, 'utf-8');
    const contextChains = JSON.parse(fileContent);
    
    // Verify structure
    if (typeof contextChains !== 'object' || contextChains === null) {
      throw new Error('Context chains in file should be an object');
    }
    
    // Verify count matches
    const messageCount = sessionData.messages.size;
    const chainCount = Object.keys(contextChains).length;
    if (chainCount !== messageCount) {
      throw new Error(`Expected ${messageCount} chains in file, got ${chainCount}`);
    }
    
    console.log(`   File created: ${outputPath}`);
    console.log(`   File size: ${fileContent.length} bytes`);
    console.log(`   Chains in file: ${chainCount}`);
    
    // Clean up test file
    await fs.promises.unlink(outputPath);
    console.log(`   Test file cleaned up`);
  })();

  // Print summary
  console.log('\n' + '='.repeat(50));
  console.log(`📊 Test Results: ${passedTests} passed, ${failedTests} failed`);
  console.log('='.repeat(50));
  
  if (failedTests > 0) {
    process.exit(1);
  }
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error running tests:', error);
  process.exit(1);
});