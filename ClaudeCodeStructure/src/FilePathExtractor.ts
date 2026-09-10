import * as fs from 'fs';
import * as path from 'path';
import { JsonlEntry } from './types';

/**
 * 从 JSONL 文件中提取所有文件路径
 */
export class FilePathExtractor {
  /**
   * 从 JSONL 文件中提取所有唯一的文件路径
   * @param jsonlFilePath JSONL 文件路径
   * @returns 所有唯一文件路径的数组
   */
  static extractAllFilePaths(jsonlFilePath: string): string[] {
    const filePaths = new Set<string>();
    const fileContent = fs.readFileSync(jsonlFilePath, 'utf-8');
    const lines = fileContent.split('\n').filter(line => line.trim());

    for (const line of lines) {
      try {
        const entry: JsonlEntry = JSON.parse(line);
        this.extractPathsFromEntry(entry, filePaths);
      } catch (error) {
        console.error('解析 JSON 行失败:', error);
      }
    }

    return Array.from(filePaths).sort();
  }

  /**
   * 从单个 JSONL 条目中提取文件路径
   */
  private static extractPathsFromEntry(entry: JsonlEntry, filePaths: Set<string>): void {
    // 处理 user 类型的消息
    if (entry.type === 'user' && entry.message?.content) {
      this.extractPathsFromContent(entry.message.content, filePaths);
    }

    // 处理 assistant 类型的消息
    if (entry.type === 'assistant' && entry.message?.content) {
      this.extractPathsFromContent(entry.message.content, filePaths);
    }

    // 处理 message 类型（包含 user/assistant/system/attachment）
    if (entry.type === 'message' && 'message' in entry && entry.message?.content) {
      this.extractPathsFromContent(entry.message.content, filePaths);
    }

    // 处理 tool-use 类型
    if (entry.type === 'tool-use' && 'toolUse' in entry) {
      this.extractPathsFromToolInput(entry.toolUse.input, filePaths);
    }

    // 处理 tool-result 类型
    if (entry.type === 'tool-result' && 'toolResult' in entry) {
      this.extractPathsFromToolResult(entry.toolResult.content, filePaths);
    }

    // 处理 file-history-snapshot 类型
    if (entry.type === 'file-history-snapshot') {
      // 提取 file-history-snapshot 中的所有字段
      const entryAny = entry as any;
      if (entryAny.files && Array.isArray(entryAny.files)) {
        for (const file of entryAny.files) {
          if (file.path) {
            filePaths.add(file.path);
          }
        }
      }
      // 也检查其他可能包含路径的字段
      this.extractPathsFromObject(entryAny, filePaths);
    }
  }

  /**
   * 从任意对象中递归提取可能的文件路径
   */
  private static extractPathsFromObject(obj: any, filePaths: Set<string>): void {
    if (!obj || typeof obj !== 'object') return;

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string' && this.looksLikeFilePath(value)) {
        filePaths.add(value);
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string' && this.looksLikeFilePath(item)) {
            filePaths.add(item);
          } else if (typeof item === 'object') {
            this.extractPathsFromObject(item, filePaths);
          }
        }
      } else if (typeof value === 'object' && value !== null) {
        this.extractPathsFromObject(value, filePaths);
      }
    }
  }

  /**
   * 从消息内容中提取文件路径
   */
  private static extractPathsFromContent(content: any, filePaths: Set<string>): void {
    if (Array.isArray(content)) {
      for (const item of content) {
        if (typeof item === 'object' && item !== null) {
          // 处理 tool_use 类型
          if (item.type === 'tool_use' && item.input) {
            this.extractPathsFromToolInput(item.input, filePaths);
          }
          // 处理 tool_result 类型
          if (item.type === 'tool_result' && item.content) {
            this.extractPathsFromToolResult(item.content, filePaths);
          }
        }
      }
    } else if (typeof content === 'string') {
      // 从字符串中提取路径（使用正则表达式）
      this.extractPathsFromString(content, filePaths);
    }
  }

  /**
   * 从工具输入中提取文件路径
   */
  private static extractPathsFromToolInput(input: Record<string, any>, filePaths: Set<string>): void {
    // 常见的路径参数名
    const pathKeys = ['file_path', 'path', 'directory', 'dir', 'source', 'destination', 'target'];
    
    for (const key of pathKeys) {
      if (input[key] && typeof input[key] === 'string') {
        filePaths.add(input[key]);
      }
    }

    // 递归处理嵌套对象
    for (const value of Object.values(input)) {
      if (typeof value === 'object' && value !== null) {
        if (Array.isArray(value)) {
          for (const item of value) {
            if (typeof item === 'string' && this.looksLikeFilePath(item)) {
              filePaths.add(item);
            }
          }
        } else {
          this.extractPathsFromToolInput(value, filePaths);
        }
      }
    }
  }

  /**
   * 从工具结果中提取文件路径
   */
  private static extractPathsFromToolResult(content: any, filePaths: Set<string>): void {
    if (typeof content === 'string') {
      this.extractPathsFromString(content, filePaths);
    } else if (Array.isArray(content)) {
      for (const item of content) {
        if (typeof item === 'string') {
          this.extractPathsFromString(item, filePaths);
        } else if (typeof item === 'object' && item !== null) {
          this.extractPathsFromToolResult(item, filePaths);
        }
      }
    } else if (typeof content === 'object' && content !== null) {
      for (const value of Object.values(content)) {
        this.extractPathsFromToolResult(value, filePaths);
      }
    }
  }

  /**
   * 从字符串中提取文件路径
   */
  private static extractPathsFromString(text: string, filePaths: Set<string>): void {
    // 匹配 XML 标签中的路径
    const xmlPathRegex = /<(?:file_)?path>(.*?)<\/(?:file_)?path>/g;
    let match;
    while ((match = xmlPathRegex.exec(text)) !== null) {
      if (match[1]) {
        filePaths.add(match[1]);
      }
    }

    // 匹配绝对路径 (Unix/Linux/Mac)
    const unixPathRegex = /(?:^|\s)(\/([\w\-\.]+\/)*[\w\-\.]+)/g;
    while ((match = unixPathRegex.exec(text)) !== null) {
      if (match[1] && this.looksLikeFilePath(match[1])) {
        filePaths.add(match[1]);
      }
    }

    // 匹配相对路径
    const relativePathRegex = /(?:^|\s)((?:\.\.?\/)?(?:[\w\-\.]+\/)+[\w\-\.]+)/g;
    while ((match = relativePathRegex.exec(text)) !== null) {
      if (match[1] && this.looksLikeFilePath(match[1])) {
        filePaths.add(match[1]);
      }
    }
  }

  /**
   * 判断字符串是否看起来像文件路径
   */
  private static looksLikeFilePath(str: string): boolean {
    // 排除太短的字符串
    if (str.length < 3) return false;
    
    // 排除纯数字
    if (/^\d+$/.test(str)) return false;
    
    // 排除 URL
    if (str.startsWith('http://') || str.startsWith('https://')) return false;
    
    // 包含路径分隔符或文件扩展名
    return str.includes('/') || str.includes('\\') || /\.\w+$/.test(str);
  }

  /**
   * 按文件类型分组文件路径
   */
  static groupPathsByExtension(filePaths: string[]): Map<string, string[]> {
    const grouped = new Map<string, string[]>();
    
    for (const filePath of filePaths) {
      const ext = path.extname(filePath) || '(no extension)';
      if (!grouped.has(ext)) {
        grouped.set(ext, []);
      }
      grouped.get(ext)!.push(filePath);
    }
    
    return grouped;
  }

  /**
   * 过滤出特定扩展名的文件路径
   */
  static filterByExtension(filePaths: string[], extensions: string[]): string[] {
    const extSet = new Set(extensions.map(ext => ext.startsWith('.') ? ext : `.${ext}`));
    return filePaths.filter(filePath => {
      const ext = path.extname(filePath);
      return extSet.has(ext);
    });
  }

  /**
   * 获取所有目录路径（去重）
   */
  static extractDirectories(filePaths: string[]): string[] {
    const directories = new Set<string>();
    
    for (const filePath of filePaths) {
      const dir = path.dirname(filePath);
      if (dir && dir !== '.') {
        directories.add(dir);
      }
    }
    
    return Array.from(directories).sort();
  }
}