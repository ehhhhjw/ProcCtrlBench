import * as fs from 'fs';
import * as path from 'path';

export interface TranscriptWatcherOptions {
  pollIntervalMs?: number;
  watchSubagents?: boolean;
  onUpdate: (transcriptPath: string) => void | Promise<void>;
}

export class TranscriptWatcher {
  private readonly pollIntervalMs: number;
  private readonly watchSubagents: boolean;
  private readonly onUpdate: (transcriptPath: string) => void | Promise<void>;
  private readonly watchedPaths = new Set<string>();

  constructor(options: TranscriptWatcherOptions) {
    this.pollIntervalMs = options.pollIntervalMs ?? 200;
    this.watchSubagents = options.watchSubagents ?? false;
    this.onUpdate = options.onUpdate;
  }

  watch(transcriptPath: string): void {
    this.watchSingleFile(path.resolve(transcriptPath));

    if (!this.watchSubagents) {
      return;
    }

    const subagentDir = path.join(
      path.dirname(path.resolve(transcriptPath)),
      path.basename(transcriptPath, '.jsonl'),
      'subagents'
    );

    if (!fs.existsSync(subagentDir)) {
      return;
    }

    for (const entry of fs.readdirSync(subagentDir)) {
      if (!entry.endsWith('.jsonl')) {
        continue;
      }
      this.watchSingleFile(path.join(subagentDir, entry));
    }
  }

  close(): void {
    for (const watchedPath of this.watchedPaths) {
      fs.unwatchFile(watchedPath);
    }
    this.watchedPaths.clear();
  }

  private watchSingleFile(transcriptPath: string): void {
    if (this.watchedPaths.has(transcriptPath)) {
      return;
    }

    let previousSize = fs.existsSync(transcriptPath) ? fs.statSync(transcriptPath).size : 0;
    fs.watchFile(
      transcriptPath,
      { interval: this.pollIntervalMs },
      (current, previous) => {
        if (current.size <= previousSize && current.mtimeMs <= previous.mtimeMs) {
          return;
        }

        previousSize = current.size;
        void Promise.resolve(this.onUpdate(transcriptPath));
      }
    );

    this.watchedPaths.add(transcriptPath);
  }
}
