import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Generic daily cap on Gemini calls, keyed by purpose (e.g. "matching"),
 * separate from Phase 2's per-job-source ingestion quota
 * (lib/jobs/quota.ts) since matching isn't tied to any one job source —
 * CONSTITUTION.md §4 / phase-04-matching-engine.md "cost control" edge
 * case. Degrades gracefully: returns false instead of throwing, so the
 * caller just stops scoring new jobs for the day rather than erroring.
 */
export async function checkAndBumpGeminiQuota(
  supabase: SupabaseClient,
  purpose: string,
  maxPerDay: number,
): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);

  const { data: existing } = await supabase
    .from("gemini_call_log")
    .select("call_count")
    .eq("purpose", purpose)
    .eq("call_date", today)
    .maybeSingle();

  const currentCount = existing?.call_count ?? 0;
  if (currentCount >= maxPerDay) {
    return false;
  }

  await supabase.from("gemini_call_log").upsert(
    { purpose, call_date: today, call_count: currentCount + 1 },
    { onConflict: "purpose,call_date" },
  );

  return true;
}
