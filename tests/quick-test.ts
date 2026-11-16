#!/usr/bin/env ts-node

/**
 * Quick test script
 * Quickly validates the project's core functionality
 */

import { AgentEvaluator } from '../src/AgentEvaluator';
import * as fs from 'fs';
import * as path from 'path';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
  details?: any;
}

class QuickTester {
  private results: TestResult[] = [];

  async runAllTests() {
    console.log('🚀 Starting quick tests...\n');

    await this.testBasicFunctionality();
    await this.testRealSessionData();
    await this.testErrorHandling();
    await this.testPerformance();

    this.printResults();
  }

  /**
   * Test 1: Basic functionality
   */
  async testBasicFunctionality() {
    const testName = 'Basic functionality test';
    const startTime = Date.now();

    try {
      console.log(`📋 ${testName}...`);

      // Check whether the core class can be instantiated
      const evaluator = new AgentEvaluator();
      
      if (!evaluator) {
        throw new Error('Unable to create an AgentEvaluator instance');
      }

      console.log('  ✅ AgentEvaluator instantiated successfully');

      this.results.push({
        name: testName,
        passed: true,
        duration: Date.now() - startTime
      });

    } catch (error) {
      console.log(`  ❌ Failed: ${error.message}`);
      this.results.push({
        name: testName,
        passed: false,
        error: error.message,
        duration: Date.now() - startTime
      });
    }
  }

  /**
   * Test 2: Real session data
   */
  async testRealSessionData() {
    const testName = 'Real session data test';
    const startTime = Date.now();

    try {
      console.log(`\n📋 ${testName}...`);

      // Find a test data file
      const testDataPaths = [
        'ClaudeCodeStructure/tests/a3d0cc87-cbb3-450a-be14-e3d86f4b12ba.jsonl',
        'ClaudeCodeStructure/tests/sample.jsonl',
        'tests/fixtures/sample-session.jsonl'
      ];

      let testDataPath: string | null = null;
      for (const p of testDataPaths) {
        if (fs.existsSync(p)) {
          testDataPath = p;
          break;
        }
      }

      if (!testDataPath) {
        throw new Error('Test data file not found');
      }

      console.log(`  📁 Using test file: ${testDataPath}`);

      const evaluator = new AgentEvaluator();
      const result = await evaluator.evaluateSession(testDataPath);

      // Validate the result structure
      if (!result) {
        throw new Error('Evaluation result is empty');
      }

      if (typeof result.overallScore !== 'number') {
        throw new Error('Overall score is not a number');
      }

      if (result.overallScore < 0 || result.overallScore > 100) {
        throw new Error(`Overall score is out of range: ${result.overallScore}`);
      }

      if (!Array.isArray(result.evaluations)) {
        throw new Error('Evaluation result is not an array');
      }

      console.log(`  ✅ Evaluation succeeded`);
      console.log(`  📊 Overall score: ${result.overallScore.toFixed(2)}`);
      console.log(`  📈 Evaluation dimensions: ${result.evaluations.length}`);

      // Display each dimension's score
      result.evaluations.forEach(evaluation => {
        console.log(`     - ${evaluation.dimension}: ${evaluation.score.toFixed(2)}`);
      });

      this.results.push({
        name: testName,
        passed: true,
        duration: Date.now() - startTime,
        details: {
          overallScore: result.overallScore,
          evaluationCount: result.evaluations.length
        }
      });

    } catch (error) {
      console.log(`  ❌ Failed: ${error.message}`);
      this.results.push({
        name: testName,
        passed: false,
        error: error.message,
        duration: Date.now() - startTime
      });
    }
  }

  /**
   * Test 3: Error handling
   */
  async testErrorHandling() {
    const testName = 'Error handling test';
    const startTime = Date.now();

    try {
      console.log(`\n📋 ${testName}...`);

      const evaluator = new AgentEvaluator();

      // Test a nonexistent file
      try {
        await evaluator.evaluateSession('nonexistent-file.jsonl');
        throw new Error('Expected a missing-file error');
      } catch (error) {
        if (error.message.includes('Expected')) {
          throw error;
        }
        console.log('  ✅ Missing-file error handled correctly');
      }

      // Test an empty path
      try {
        await evaluator.evaluateSession('');
        throw new Error('Expected an empty-path error');
      } catch (error) {
        if (error.message.includes('Expected')) {
          throw error;
        }
        console.log('  ✅ Empty-path error handled correctly');
      }

      this.results.push({
        name: testName,
        passed: true,
        duration: Date.now() - startTime
      });

    } catch (error) {
      console.log(`  ❌ Failed: ${error.message}`);
      this.results.push({
        name: testName,
        passed: false,
        error: error.message,
        duration: Date.now() - startTime
      });
    }
  }

  /**
   * Test 4: Performance
   */
  async testPerformance() {
    const testName = 'Performance test';
    const startTime = Date.now();

    try {
      console.log(`\n📋 ${testName}...`);

      // Find the test data file
      const testDataPath = 'ClaudeCodeStructure/tests/a3d0cc87-cbb3-450a-be14-e3d86f4b12ba.jsonl';

      if (!fs.existsSync(testDataPath)) {
        console.log('  ⚠️  Skipping performance test (test data not found)');
        this.results.push({
          name: testName,
          passed: true,
          duration: 0,
          details: { skipped: true }
        });
        return;
      }

      // Get the file size
      const stats = fs.statSync(testDataPath);
      const fileSizeKB = stats.size / 1024;

      console.log(`  📁 File size: ${fileSizeKB.toFixed(2)} KB`);

      const evaluator = new AgentEvaluator();
      const perfStart = Date.now();
      await evaluator.evaluateSession(testDataPath);
      const perfDuration = Date.now() - perfStart;

      const throughput = fileSizeKB / (perfDuration / 1000); // KB/s

      console.log(`  ⏱️  Processing time: ${perfDuration}ms`);
      console.log(`  🚀 Throughput: ${throughput.toFixed(2)} KB/s`);

      // Performance benchmark: should finish within a reasonable time
      if (perfDuration > 10000) {
        throw new Error(`Processing took too long: ${perfDuration}ms`);
      }

      this.results.push({
        name: testName,
        passed: true,
        duration: Date.now() - startTime,
        details: {
          processingTime: perfDuration,
          throughput: throughput.toFixed(2)
        }
      });

    } catch (error) {
      console.log(`  ❌ Failed: ${error.message}`);
      this.results.push({
        name: testName,
        passed: false,
        error: error.message,
        duration: Date.now() - startTime
      });
    }
  }

  /**
   * Print test results
   */
  printResults() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 Test Results Summary');
    console.log('='.repeat(60));

    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const total = this.results.length;

    this.results.forEach(result => {
      const icon = result.passed ? '✅' : '❌';
      const duration = `${result.duration}ms`;
      console.log(`${icon} ${result.name.padEnd(30)} ${duration.padStart(10)}`);
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
    });

    console.log('='.repeat(60));
    console.log(`Total: ${total} | Passed: ${passed} | Failed: ${failed}`);
    console.log(`Success rate: ${((passed / total) * 100).toFixed(2)}%`);
    console.log('='.repeat(60));

    if (failed > 0) {
      console.log('\n⚠️  Some tests failed; review the errors above');
      process.exit(1);
    } else {
      console.log('\n🎉 All tests passed!');
      process.exit(0);
    }
  }
}

// Run tests
const tester = new QuickTester();
tester.runAllTests().catch(error => {
  console.error('Test run failed:', error);
  process.exit(1);
});