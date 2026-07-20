import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Generous relative to the real pipeline's wall-clock (ingest/match/draft
// each cap at maxDuration=60s, notify is fast) — long enough that a
// genuinely-running pipeline is never mistaken for stale, short enough
// that a crashed run doesn't block the next scheduled cycle for long.
const STALE_MS = 15 * 60 * 1000;

export type PipelineTrigger = "cron" | "manual";

/**
 * /api/ingest calls this first. GitHub Actions won't queue a second
 * scheduled run of the same workflow, but that doesn't stop the manual
 * "Run now" button from overlapping one — this DB row is the actual lock.
 */
export async function acquirePipelineLock(
  supabase: SupabaseClient,
  trigger: PipelineTrigger,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data: latest } = await supabase
    .from("pipeline_runs")
    .select("id, status, started_at")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest && latest.status === "running") {
    const age = Date.now() - new Date(latest.started_at as string).getTime();
    if (age < STALE_MS) {
      return { ok: false, reason: "A pipeline run is already in progress." };
    }
    // Stale — the previous run crashed without reaching /api/notify (its
    // release step). Close it out so it doesn't sit as a permanent mystery
    // "running" row, then proceed with a fresh one.
    await supabase
      .from("pipeline_runs")
      .update({ status: "failed", finished_at: new Date().toISOString(), error_text: "Stale lock — assumed crashed" })
      .eq("id", latest.id as string);
  }

  const { error } = await supabase.from("pipeline_runs").insert({ status: "running", trigger });
  if (error) {
    return { ok: false, reason: error.message };
  }
  return { ok: true };
}

/**
 * /api/notify calls this last, regardless of whether it actually sent an
 * email — reaching notify at all means the pipeline completed its sequence.
 * No-ops if nothing is currently marked "running" (e.g. notify called on
 * its own, outside a full pipeline run).
 */
export async function releasePipelineLock(
  supabase: SupabaseClient,
  status: "completed" | "failed",
  errorText?: string,
): Promise<void> {
  const { data: latest } = await supabase
    .from("pipeline_runs")
    .select("id, status")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latest || latest.status !== "running") return;

  await supabase
    .from("pipeline_runs")
    .update({ status, finished_at: new Date().toISOString(), error_text: errorText ?? null })
    .eq("id", latest.id as string);
}
