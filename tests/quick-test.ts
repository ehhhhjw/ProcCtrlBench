#!/usr/bin/env ts-node

/**
 * 快速测试脚本
 * 用于快速验证项目的核心功能
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
    console.log('🚀 开始快速测试...\n');

    await this.testBasicFunctionality();
    await this.testRealSessionData();
    await this.testErrorHandling();
    await this.testPerformance();

    this.printResults();
  }

  /**
   * 测试 1: 基本功能测试
   */
  async testBasicFunctionality() {
    const testName = '基本功能测试';
    const startTime = Date.now();

    try {
      console.log(`📋 ${testName}...`);

      // 检查核心类是否可以实例化
      const evaluator = new AgentEvaluator();
      
      if (!evaluator) {
        throw new Error('无法创建 AgentEvaluator 实例');
      }

      console.log('  ✅ AgentEvaluator 实例化成功');

      this.results.push({
        name: testName,
        passed: true,
        duration: Date.now() - startTime
      });

    } catch (error) {
      console.log(`  ❌ 失败: ${error.message}`);
      this.results.push({
        name: testName,
        passed: false,
        error: error.message,
        duration: Date.now() - startTime
      });
    }
  }

  /**
   * 测试 2: 真实会话数据测试
   */
  async testRealSessionData() {
    const testName = '真实会话数据测试';
    const startTime = Date.now();

    try {
      console.log(`\n📋 ${testName}...`);

      // 查找测试数据文件
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
        throw new Error('未找到测试数据文件');
      }

      console.log(`  📁 使用测试文件: ${testDataPath}`);

      const evaluator = new AgentEvaluator();
      const result = await evaluator.evaluateSession(testDataPath);

      // 验证结果结构
      if (!result) {
        throw new Error('评估结果为空');
      }

      if (typeof result.overallScore !== 'number') {
        throw new Error('总分不是数字类型');
      }

      if (result.overallScore < 0 || result.overallScore > 100) {
        throw new Error(`总分超出范围: ${result.overallScore}`);
      }

      if (!Array.isArray(result.evaluations)) {
        throw new Error('评估结果不是数组');
      }

      console.log(`  ✅ 评估成功`);
      console.log(`  📊 总分: ${result.overallScore.toFixed(2)}`);
      console.log(`  📈 评估维度数: ${result.evaluations.length}`);

      // 显示各维度得分
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
      console.log(`  ❌ 失败: ${error.message}`);
      this.results.push({
        name: testName,
        passed: false,
        error: error.message,
        duration: Date.now() - startTime
      });
    }
  }

  /**
   * 测试 3: 错误处理测试
   */
  async testErrorHandling() {
    const testName = '错误处理测试';
    const startTime = Date.now();

    try {
      console.log(`\n📋 ${testName}...`);

      const evaluator = new AgentEvaluator();

      // 测试不存在的文件
      try {
        await evaluator.evaluateSession('nonexistent-file.jsonl');
        throw new Error('应该抛出文件不存在错误');
      } catch (error) {
        if (error.message.includes('应该抛出')) {
          throw error;
        }
        console.log('  ✅ 正确处理文件不存在错误');
      }

      // 测试空路径
      try {
        await evaluator.evaluateSession('');
        throw new Error('应该抛出空路径错误');
      } catch (error) {
        if (error.message.includes('应该抛出')) {
          throw error;
        }
        console.log('  ✅ 正确处理空路径错误');
      }

      this.results.push({
        name: testName,
        passed: true,
        duration: Date.now() - startTime
      });

    } catch (error) {
      console.log(`  ❌ 失败: ${error.message}`);
      this.results.push({
        name: testName,
        passed: false,
        error: error.message,
        duration: Date.now() - startTime
      });
    }
  }

  /**
   * 测试 4: 性能测试
   */
  async testPerformance() {
    const testName = '性能测试';
    const startTime = Date.now();

    try {
      console.log(`\n📋 ${testName}...`);

      // 查找测试数据文件
      const testDataPath = 'ClaudeCodeStructure/tests/a3d0cc87-cbb3-450a-be14-e3d86f4b12ba.jsonl';

      if (!fs.existsSync(testDataPath)) {
        console.log('  ⚠️  跳过性能测试（未找到测试数据）');
        this.results.push({
          name: testName,
          passed: true,
          duration: 0,
          details: { skipped: true }
        });
        return;
      }

      // 获取文件大小
      const stats = fs.statSync(testDataPath);
      const fileSizeKB = stats.size / 1024;

      console.log(`  📁 文件大小: ${fileSizeKB.toFixed(2)} KB`);

      const evaluator = new AgentEvaluator();
      const perfStart = Date.now();
      await evaluator.evaluateSession(testDataPath);
      const perfDuration = Date.now() - perfStart;

      const throughput = fileSizeKB / (perfDuration / 1000); // KB/s

      console.log(`  ⏱️  处理时间: ${perfDuration}ms`);
      console.log(`  🚀 吞吐量: ${throughput.toFixed(2)} KB/s`);

      // 性能基准：应该在合理时间内完成
      if (perfDuration > 10000) {
        throw new Error(`处理时间过长: ${perfDuration}ms`);
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
      console.log(`  ❌ 失败: ${error.message}`);
      this.results.push({
        name: testName,
        passed: false,
        error: error.message,
        duration: Date.now() - startTime
      });
    }
  }

  /**
   * 打印测试结果
   */
  printResults() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 测试结果汇总');
    console.log('='.repeat(60));

    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const total = this.results.length;

    this.results.forEach(result => {
      const icon = result.passed ? '✅' : '❌';
      const duration = `${result.duration}ms`;
      console.log(`${icon} ${result.name.padEnd(30)} ${duration.padStart(10)}`);
      if (result.error) {
        console.log(`   错误: ${result.error}`);
      }
    });

    console.log('='.repeat(60));
    console.log(`总计: ${total} | 通过: ${passed} | 失败: ${failed}`);
    console.log(`成功率: ${((passed / total) * 100).toFixed(2)}%`);
    console.log('='.repeat(60));

    if (failed > 0) {
      console.log('\n⚠️  存在失败的测试，请检查上述错误信息');
      process.exit(1);
    } else {
      console.log('\n🎉 所有测试通过！');
      process.exit(0);
    }
  }
}

// 运行测试
const tester = new QuickTester();
tester.runAllTests().catch(error => {
  console.error('测试运行失败:', error);
  process.exit(1);
});