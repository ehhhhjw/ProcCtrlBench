import * as fs from 'fs';

/**
 * Loads an externally generated file association graph in JSON form.
 * Example JSON structure: { "src/a.ts": ["src/b.ts","src/c.ts"], ... }
 */
export class FileAssociationLoader {
  private associations: Map<string, string[]> = new Map();

  constructor(private jsonPath: string) {}

  load(): void {
    if (!fs.existsSync(this.jsonPath)) throw new Error(`File graph not found: ${this.jsonPath}`);
    const raw = fs.readFileSync(this.jsonPath, 'utf-8');
    const obj = JSON.parse(raw) as Record<string, string[]>;
    this.associations = new Map(Object.entries(obj));
  }

  /** Returns the core association set for a file (an empty array if none) */
  get(filePath: string): string[] {
    return this.associations.get(filePath) || [];
  }

  /** Checks whether a core association exists between two files */
  isAssociated(a: string, b: string): boolean {
    const list = this.get(a);
    return list.includes(b);
  }
}
