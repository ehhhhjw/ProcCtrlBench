import * as fs from 'fs';
import * as path from 'path';
import { JsonlEntry } from './types';

/**
 * Extracts all file paths from a JSONL file
 */
export class FilePathExtractor {
  /**
   * Extracts all unique file paths from a JSONL file
   * @param jsonlFilePath Path to the JSONL file
   * @returns An array of all unique file paths
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
        console.error('Failed to parse JSON line:', error);
      }
    }

    return Array.from(filePaths).sort();
  }

  /**
   * Extracts file paths from a single JSONL entry
   */
  private static extractPathsFromEntry(entry: JsonlEntry, filePaths: Set<string>): void {
    // Handle messages of type user
    if (entry.type === 'user' && entry.message?.content) {
      this.extractPathsFromContent(entry.message.content, filePaths);
    }

    // Handle messages of type assistant
    if (entry.type === 'assistant' && entry.message?.content) {
      this.extractPathsFromContent(entry.message.content, filePaths);
    }

    // Handle the message type (covers user/assistant/system/attachment)
    if (entry.type === 'message' && 'message' in entry && entry.message?.content) {
      this.extractPathsFromContent(entry.message.content, filePaths);
    }

    // Handle the tool-use type
    if (entry.type === 'tool-use' && 'toolUse' in entry) {
      this.extractPathsFromToolInput(entry.toolUse.input, filePaths);
    }

    // Handle the tool-result type
    if (entry.type === 'tool-result' && 'toolResult' in entry) {
      this.extractPathsFromToolResult(entry.toolResult.content, filePaths);
    }

    // Handle the file-history-snapshot type
    if (entry.type === 'file-history-snapshot') {
      // Extract all fields within file-history-snapshot
      const entryAny = entry as any;
      if (entryAny.files && Array.isArray(entryAny.files)) {
        for (const file of entryAny.files) {
          if (file.path) {
            filePaths.add(file.path);
          }
        }
      }
      // Also check other fields that may contain paths
      this.extractPathsFromObject(entryAny, filePaths);
    }
  }

  /**
   * Recursively extracts possible file paths from an arbitrary object
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
   * Extracts file paths from message content
   */
  private static extractPathsFromContent(content: any, filePaths: Set<string>): void {
    if (Array.isArray(content)) {
      for (const item of content) {
        if (typeof item === 'object' && item !== null) {
          // Handle the tool_use type
          if (item.type === 'tool_use' && item.input) {
            this.extractPathsFromToolInput(item.input, filePaths);
          }
          // Handle the tool_result type
          if (item.type === 'tool_result' && item.content) {
            this.extractPathsFromToolResult(item.content, filePaths);
          }
        }
      }
    } else if (typeof content === 'string') {
      // Extract paths from the string (using regular expressions)
      this.extractPathsFromString(content, filePaths);
    }
  }

  /**
   * Extracts file paths from tool input
   */
  private static extractPathsFromToolInput(input: Record<string, any>, filePaths: Set<string>): void {
    // Common path parameter names
    const pathKeys = ['file_path', 'path', 'directory', 'dir', 'source', 'destination', 'target'];

    for (const key of pathKeys) {
      if (input[key] && typeof input[key] === 'string') {
        filePaths.add(input[key]);
      }
    }

    // Recursively handle nested objects
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
   * Extracts file paths from tool results
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
   * Extracts file paths from a string
   */
  private static extractPathsFromString(text: string, filePaths: Set<string>): void {
    // Match paths inside XML tags
    const xmlPathRegex = /<(?:file_)?path>(.*?)<\/(?:file_)?path>/g;
    let match;
    while ((match = xmlPathRegex.exec(text)) !== null) {
      if (match[1]) {
        filePaths.add(match[1]);
      }
    }

    // Match absolute paths (Unix/Linux/Mac)
    const unixPathRegex = /(?:^|\s)(\/([\w\-\.]+\/)*[\w\-\.]+)/g;
    while ((match = unixPathRegex.exec(text)) !== null) {
      if (match[1] && this.looksLikeFilePath(match[1])) {
        filePaths.add(match[1]);
      }
    }

    // Match relative paths
    const relativePathRegex = /(?:^|\s)((?:\.\.?\/)?(?:[\w\-\.]+\/)+[\w\-\.]+)/g;
    while ((match = relativePathRegex.exec(text)) !== null) {
      if (match[1] && this.looksLikeFilePath(match[1])) {
        filePaths.add(match[1]);
      }
    }
  }

  /**
   * Determines whether a string looks like a file path
   */
  private static looksLikeFilePath(str: string): boolean {
    // Exclude strings that are too short
    if (str.length < 3) return false;

    // Exclude pure numbers
    if (/^\d+$/.test(str)) return false;

    // Exclude URLs
    if (str.startsWith('http://') || str.startsWith('https://')) return false;

    // Must contain a path separator or a file extension
    return str.includes('/') || str.includes('\\') || /\.\w+$/.test(str);
  }

  /**
   * Groups file paths by file type
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
   * Filters out file paths with specific extensions
   */
  static filterByExtension(filePaths: string[], extensions: string[]): string[] {
    const extSet = new Set(extensions.map(ext => ext.startsWith('.') ? ext : `.${ext}`));
    return filePaths.filter(filePath => {
      const ext = path.extname(filePath);
      return extSet.has(ext);
    });
  }

  /**
   * Gets all directory paths (deduplicated)
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
