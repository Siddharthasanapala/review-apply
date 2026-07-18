import "server-only";
import { getGeminiClient, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from "./client";
import { retryWithBackoff } from "./retryWithBackoff";

export type EmbedTextResult = { ok: true; embedding: number[] } | { ok: false; error: string };

export async function embedText(text: string): Promise<EmbedTextResult> {
  const client = getGeminiClient();
  if (!client) {
    return { ok: false, error: "GEMINI_API_KEY not configured" };
  }

  try {
    const values = await retryWithBackoff(async () => {
      const response = await client.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: text,
        config: { outputDimensionality: EMBEDDING_DIMENSIONS },
      });

      const embeddingValues = response.embeddings?.[0]?.values;
      if (!embeddingValues || embeddingValues.length === 0) {
        throw new Error("Empty embedding response");
      }
      return embeddingValues;
    });

    return { ok: true, embedding: values };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Embedding failed" };
  }
}
