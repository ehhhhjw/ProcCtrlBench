/**
 * Claude Code JSONL Parser - Main Entry Point
 * 
 * This library provides comprehensive parsing and analysis capabilities
 * for Claude Code session JSONL files.
 */

// Core Classes
export { SessionDataImpl } from './SessionData';
export { JsonlParser } from './JsonlParser';
export { SessionDataQuery } from './SessionDataQuery';
export { SessionDataExporter } from './SessionDataExporter';
export { SessionAnalyzer } from './SessionAnalyzer';

// Type Definitions
export * from './types';

// Convenience function for quick parsing
import { JsonlParser } from './JsonlParser';
import { SessionDataImpl } from './SessionData';

/**
 * Parse a JSONL file and return session data
 * @param filePath Path to the JSONL file
 * @returns Parsed session data
 */
export async function parseSessionFile(filePath: string): Promise<SessionDataImpl> {
  const parser = new JsonlParser();
  return await parser.parseFile(filePath);
}

/**
 * Parse JSONL content string and return session data
 * @param content JSONL content as string
 * @returns Parsed session data
 */
export function parseSessionContent(content: string): SessionDataImpl {
  const parser = new JsonlParser();
  return parser.parseContent(content);
}