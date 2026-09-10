import * as fs from 'fs';

/**
 * 读取外部生成的文件关联图谱 JSON。
 * JSON 结构示例：{ "src/a.ts": ["src/b.ts","src/c.ts"], ... }
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

  /** 获取文件的核心关联集合（若无则返回空数组） */
  get(filePath: string): string[] {
    return this.associations.get(filePath) || [];
  }

  /** 检查两个文件是否存在核心关联 */
  isAssociated(a: string, b: string): boolean {
    const list = this.get(a);
    return list.includes(b);
  }
}
