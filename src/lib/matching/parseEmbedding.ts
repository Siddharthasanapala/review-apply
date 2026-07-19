/**
 * Supabase/PostgREST returns pgvector columns as their string
 * representation ("[0.012,-0.034,...]"), not a parsed JS array — found via
 * real testing: a raw `.length` on that string measured character count
 * (9576) instead of vector dimensions (768), corrupting cosine similarity.
 * Every embedding read back FROM the database must go through this before
 * use; embeddings fresh out of the Gemini SDK are already real arrays and
 * don't need it.
 */
export function parseEmbedding(value: unknown): number[] | null {
  if (!value) return null;
  if (Array.isArray(value)) return value as number[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}
