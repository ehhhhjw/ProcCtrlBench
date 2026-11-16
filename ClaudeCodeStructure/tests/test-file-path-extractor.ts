import { FilePathExtractor } from '../src/FilePathExtractor';
import * as path from 'path';

/**
 * Tests the file path extraction feature
 */
function testFilePathExtractor() {
  console.log('=== Testing File Path Extractor ===\n');

  const jsonlFilePath = path.join(__dirname, 'a3d0cc87-cbb3-450a-be14-e3d86f4b12ba.jsonl');

  console.log(`Extracting paths from file: ${jsonlFilePath}\n`);

  // Extract all file paths
  const allPaths = FilePathExtractor.extractAllFilePaths(jsonlFilePath);

  console.log(`✓ Found ${allPaths.length} unique file paths\n`);

  // Show the first 20 paths
  console.log('First 20 file paths:');
  console.log('─'.repeat(80));
  allPaths.slice(0, 20).forEach((filePath, index) => {
    console.log(`${(index + 1).toString().padStart(2)}. ${filePath}`);
  });

  if (allPaths.length > 20) {
    console.log(`... and ${allPaths.length - 20} more paths\n`);
  } else {
    console.log();
  }

  // Group by extension
  console.log('\n=== Grouped by File Extension ===\n');
  const grouped = FilePathExtractor.groupPathsByExtension(allPaths);
  const sortedExtensions = Array.from(grouped.keys()).sort();

  for (const ext of sortedExtensions) {
    const files = grouped.get(ext)!;
    console.log(`${ext.padEnd(20)} : ${files.length} files`);
  }

  // Extract Python files
  console.log('\n=== Python Files (.py) ===\n');
  const pythonFiles = FilePathExtractor.filterByExtension(allPaths, ['.py']);
  console.log(`Found ${pythonFiles.length} Python files:`);
  pythonFiles.slice(0, 10).forEach((file, index) => {
    console.log(`${(index + 1).toString().padStart(2)}. ${file}`);
  });
  if (pythonFiles.length > 10) {
    console.log(`... and ${pythonFiles.length - 10} more Python files`);
  }

  // Extract directories
  console.log('\n=== Directory Paths ===\n');
  const directories = FilePathExtractor.extractDirectories(allPaths);
  console.log(`Found ${directories.length} unique directories:`);
  directories.slice(0, 15).forEach((dir, index) => {
    console.log(`${(index + 1).toString().padStart(2)}. ${dir}`);
  });
  if (directories.length > 15) {
    console.log(`... and ${directories.length - 15} more directories`);
  }

  // Save the full results to a file
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

  console.log(`\n✓ Full results saved to: ${outputPath}`);
}

// Run the test
testFilePathExtractor();
