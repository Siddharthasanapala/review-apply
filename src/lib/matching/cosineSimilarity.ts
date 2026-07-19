/**
 * Plain-JS cosine similarity, computed application-side rather than via a
 * pgvector SQL operator/RPC function — simplest option at this app's
 * volume (hundreds, not millions, of jobs), avoids a migration-managed
 * Postgres function for one comparison. Revisit only if match volume
 * grows enough that this becomes a measurable bottleneck.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
