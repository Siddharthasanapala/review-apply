import "server-only";

/**
 * Every external API call in this app goes through this: a timeout plus
 * retry-with-backoff (max 3 by default), per CONSTITUTION.md §4. Non-2xx
 * responses that aren't a 5xx are returned as-is (caller decides how to
 * handle a 4xx) rather than retried, since retrying a bad request just
 * burns quota for no benefit.
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  opts?: { retries?: number; timeoutMs?: number },
): Promise<Response> {
  const retries = opts?.retries ?? 3;
  const timeoutMs = opts?.timeoutMs ?? 10000;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeout);

      if (res.ok || res.status < 500) {
        return res;
      }

      if (attempt < retries) {
        await sleep(backoffMs(attempt));
        continue;
      }

      return res;
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;
      if (attempt < retries) {
        await sleep(backoffMs(attempt));
        continue;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("fetchWithRetry failed");
}

function backoffMs(attempt: number): number {
  return 500 * 2 ** attempt;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
