/**
 * Content similarity analyzer
 */
export class ContentSimilarityAnalyzer {
  private static readonly MAX_LEVENSHTEIN_LENGTH = 4000;
  private static readonly MAX_LEVENSHTEIN_PRODUCT = 2_000_000;
  private static readonly LARGE_TEXT_TOKEN_LIMIT = 512;

  /**
   * Computes the similarity between two strings
   */
  static calculateSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1.0;
    if (!str1 || !str2) return 0.0;

    if (
      str1.length > this.MAX_LEVENSHTEIN_LENGTH ||
      str2.length > this.MAX_LEVENSHTEIN_LENGTH ||
      str1.length * str2.length > this.MAX_LEVENSHTEIN_PRODUCT
    ) {
      return this.calculateLargeTextSimilarity(str1, str2);
    }

    // Use the normalized form of the Levenshtein distance
    const distance = this.levenshteinDistance(str1, str2);
    const maxLength = Math.max(str1.length, str2.length);

    if (maxLength === 0) return 1.0;

    return 1 - distance / maxLength;
  }

  private static calculateLargeTextSimilarity(str1: string, str2: string): number {
    const tokens1 = new Set(this.tokenize(str1).slice(0, this.LARGE_TEXT_TOKEN_LIMIT));
    const tokens2 = new Set(this.tokenize(str2).slice(0, this.LARGE_TEXT_TOKEN_LIMIT));

    if (tokens1.size === 0 || tokens2.size === 0) {
      const left = str1.replace(/\s+/g, ' ').trim();
      const right = str2.replace(/\s+/g, ' ').trim();
      if (!left || !right) {
        return 0;
      }
      return left === right ? 1 : 0;
    }

    let overlap = 0;
    for (const token of tokens1) {
      if (tokens2.has(token)) {
        overlap++;
      }
    }

    return overlap / new Set([...tokens1, ...tokens2]).size;
  }

  /**
   * Computes the similarity between two objects
   */
  static calculateObjectSimilarity(obj1: any, obj2: any): number {
    const str1 = JSON.stringify(obj1, null, 0);
    const str2 = JSON.stringify(obj2, null, 0);

    return this.calculateSimilarity(str1, str2);
  }

  /**
   * Levenshtein distance algorithm
   */
  private static levenshteinDistance(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;

    // Create the distance matrix
    const matrix: number[][] = Array(len1 + 1)
      .fill(null)
      .map(() => Array(len2 + 1).fill(0));

    // Initialize the first row and the first column
    for (let i = 0; i <= len1; i++) {
      matrix[i][0] = i;
    }
    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    // Compute the distances
    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;

        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,      // deletion
          matrix[i][j - 1] + 1,      // insertion
          matrix[i - 1][j - 1] + cost // substitution
        );
      }
    }

    return matrix[len1][len2];
  }

  /**
   * Computes cosine similarity (for text vectors)
   */
  static calculateCosineSimilarity(text1: string, text2: string): number {
    const words1 = this.tokenize(text1);
    const words2 = this.tokenize(text2);

    // Build the bag of words
    const allWords = new Set([...words1, ...words2]);
    const vector1 = Array.from(allWords).map(word => words1.filter(w => w === word).length);
    const vector2 = Array.from(allWords).map(word => words2.filter(w => w === word).length);

    // Compute the cosine similarity
    const dotProduct = vector1.reduce((sum, val, i) => sum + val * vector2[i], 0);
    const magnitude1 = Math.sqrt(vector1.reduce((sum, val) => sum + val * val, 0));
    const magnitude2 = Math.sqrt(vector2.reduce((sum, val) => sum + val * val, 0));

    if (magnitude1 === 0 || magnitude2 === 0) return 0;

    return dotProduct / (magnitude1 * magnitude2);
  }

  /**
   * Tokenizes text
   */
  private static tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 0);
  }

  /**
   * Structural similarity (for JSON objects)
   */
  static calculateStructuralSimilarity(obj1: any, obj2: any): number {
    // Compare the structure of the objects
    const keys1 = Object.keys(obj1 || {}).sort();
    const keys2 = Object.keys(obj2 || {}).sort();

    // Key similarity
    const keySimilarity = this.calculateSimilarity(
      keys1.join(','),
      keys2.join(',')
    );

    // Value similarity
    const commonKeys = keys1.filter(k => keys2.includes(k));
    if (commonKeys.length === 0) return keySimilarity;

    let valueSimilarity = 0;
    for (const key of commonKeys) {
      const val1 = obj1[key];
      const val2 = obj2[key];

      if (typeof val1 === 'object' && typeof val2 === 'object') {
        valueSimilarity += this.calculateStructuralSimilarity(val1, val2);
      } else {
        valueSimilarity += this.calculateSimilarity(String(val1), String(val2));
      }
    }

    valueSimilarity /= commonKeys.length;

    // Combined similarity
    return (keySimilarity + valueSimilarity) / 2;
  }
}
