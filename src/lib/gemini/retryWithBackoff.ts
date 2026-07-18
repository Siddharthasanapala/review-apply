import "server-only";

/**
 * Retry-with-backoff for Gemini calls, matching the pattern used for HTTP
 * calls elsewhere (lib/http/fetchWithRetry.ts) — CONSTITUTION.md §4
 * requires this for every external API call, and the original
 * extractProfile implementation retried once with NO delay, which is
 * useless against a rate limit (an immediate retry just hits the same
 * limit again). Found via real testing in Phase 3: two consecutive resume
 * uploads both failed extraction silently, most likely from hitting the
 * Gemini free-tier RPM cap with no backoff to recover from it.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts?: { retries?: number; baseDelayMs?: number },
): Promise<T> {
  const retries = opts?.retries ?? 3;
  const baseDelayMs = opts?.baseDelayMs ?? 1000;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      console.error(`Gemini call failed (attempt ${attempt + 1}/${retries + 1}):`, err);
      if (attempt < retries) {
        await sleep(baseDelayMs * 2 ** attempt);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Gemini call failed after retries");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
