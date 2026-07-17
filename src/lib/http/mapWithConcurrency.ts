import "server-only";

/**
 * Runs `fn` over `items` with at most `concurrency` in flight at once.
 * A single failed item is caught and reported via `onError` rather than
 * rejecting the whole batch — callers that need per-item failure isolation
 * (e.g. "one company's failure doesn't block the others") get it for free.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
  onError?: (item: T, err: unknown) => void,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index++;
      try {
        results[current] = await fn(items[current]);
      } catch (err) {
        onError?.(items[current], err);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);

  return results.filter((r) => r !== undefined);
}
