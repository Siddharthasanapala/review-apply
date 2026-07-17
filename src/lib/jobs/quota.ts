import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

interface SourceRow {
  id: string;
  base_config: { rateLimit?: { maxCallsPerDay?: number } } | null;
}

/**
 * Degrades gracefully when a source's daily call budget is used up
 * (phase-02-ingestion.md "API quota exhaustion" edge case): returns false
 * instead of throwing, so the ingest route just skips this source for the
 * rest of the day rather than erroring the whole run. Sources with no
 * configured cap are treated as unlimited here (still protected by
 * fetchWithRetry's timeout/retry behavior).
 */
export async function checkAndBumpQuota(
  supabase: SupabaseClient,
  source: SourceRow,
): Promise<boolean> {
  const maxPerDay = source.base_config?.rateLimit?.maxCallsPerDay;
  if (!maxPerDay) return true;

  const today = new Date().toISOString().slice(0, 10);

  const { data: existing } = await supabase
    .from("job_source_call_log")
    .select("call_count")
    .eq("source_id", source.id)
    .eq("call_date", today)
    .maybeSingle();

  const currentCount = existing?.call_count ?? 0;
  if (currentCount >= maxPerDay) {
    return false;
  }

  await supabase.from("job_source_call_log").upsert(
    { source_id: source.id, call_date: today, call_count: currentCount + 1 },
    { onConflict: "source_id,call_date" },
  );

  return true;
}
