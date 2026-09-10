import { FilePathExtractor } from '../src/FilePathExtractor';
import * as path from 'path';

/**
 * 测试文件路径提取功能
 */
function testFilePathExtractor() {
  console.log('=== 测试文件路径提取器 ===\n');

  const jsonlFilePath = path.join(__dirname, 'a3d0cc87-cbb3-450a-be14-e3d86f4b12ba.jsonl');
  
  console.log(`正在从文件中提取路径: ${jsonlFilePath}\n`);

  // 提取所有文件路径
  const allPaths = FilePathExtractor.extractAllFilePaths(jsonlFilePath);
  
  console.log(`✓ 共找到 ${allPaths.length} 个唯一文件路径\n`);
  
  // 显示前 20 个路径
  console.log('前 20 个文件路径:');
  console.log('─'.repeat(80));
  allPaths.slice(0, 20).forEach((filePath, index) => {
    console.log(`${(index + 1).toString().padStart(2)}. ${filePath}`);
  });
  
  if (allPaths.length > 20) {
    console.log(`... 还有 ${allPaths.length - 20} 个路径\n`);
  } else {
    console.log();
  }

  // 按扩展名分组
  console.log('\n=== 按文件扩展名分组 ===\n');
  const grouped = FilePathExtractor.groupPathsByExtension(allPaths);
  const sortedExtensions = Array.from(grouped.keys()).sort();
  
  for (const ext of sortedExtensions) {
    const files = grouped.get(ext)!;
    console.log(`${ext.padEnd(20)} : ${files.length} 个文件`);
  }

  // 提取 Python 文件
  console.log('\n=== Python 文件 (.py) ===\n');
  const pythonFiles = FilePathExtractor.filterByExtension(allPaths, ['.py']);
  console.log(`共找到 ${pythonFiles.length} 个 Python 文件:`);
  pythonFiles.slice(0, 10).forEach((file, index) => {
    console.log(`${(index + 1).toString().padStart(2)}. ${file}`);
  });
  if (pythonFiles.length > 10) {
    console.log(`... 还有 ${pythonFiles.length - 10} 个 Python 文件`);
  }

  // 提取目录
  console.log('\n=== 目录路径 ===\n');
  const directories = FilePathExtractor.extractDirectories(allPaths);
  console.log(`共找到 ${directories.length} 个唯一目录:`);
  directories.slice(0, 15).forEach((dir, index) => {
    console.log(`${(index + 1).toString().padStart(2)}. ${dir}`);
  });
  if (directories.length > 15) {
    console.log(`... 还有 ${directories.length - 15} 个目录`);
  }

  // 保存完整结果到文件
  const fs = require('fs');
  const outputPath = path.join(__dirname, 'output', 'extracted-file-paths.json');
  
  const result = {
    totalPaths: allPaths.length,
    allPaths: allPaths,
    byExtension: Object.fromEntries(grouped),
    directories: directories,
    pythonFiles: pythonFiles,
    extractedAt: new Date().toISOString()
  };
  
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
  
  console.log(`\n✓ 完整结果已保存到: ${outputPath}`);
}

// 运行测试
testFilePathExtractor();