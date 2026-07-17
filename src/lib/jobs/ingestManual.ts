import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeDedupeHash } from "@/lib/jobs/dedupe";
import { classifyLocation } from "@/lib/jobs/location";

export interface ManualJobInput {
  url: string;
  company?: string;
  title?: string;
  location?: string;
  descriptionRaw?: string;
}

export type ManualIngestResult =
  | { outcome: "linked_existing"; jobId: string }
  | { outcome: "inserted_new"; jobId: string };

/**
 * Manual job entry (e.g. pasted from LinkedIn). Never fetches the given
 * URL server-side — only stores what the user typed/pasted, per
 * CONSTITUTION.md §1's manual-entry compliance note. Runs through the same
 * dedupe_hash check as auto-ingested jobs so a job the user pastes in that
 * also exists via Greenhouse/Adzuna gets linked, not duplicated
 * (phase-02-ingestion.md edge case).
 */
export async function upsertManualJob(
  supabase: SupabaseClient,
  input: ManualJobInput,
  manualSourceId: string,
): Promise<ManualIngestResult> {
  const company = input.company?.trim() || "Unknown";
  const title = input.title?.trim() || "Untitled";
  const location = input.location?.trim() || null;

  const dedupeHash = computeDedupeHash(company, title, location);

  if (input.company && input.title) {
    const { data: hashMatches } = await supabase
      .from("jobs")
      .select("id")
      .eq("dedupe_hash", dedupeHash);

    if (hashMatches && hashMatches.length === 1) {
      const matchedJobId = hashMatches[0].id as string;
      await supabase.from("job_source_links").insert({
        job_id: matchedJobId,
        source_id: manualSourceId,
        source_external_id: null,
        source_url: input.url,
      });
      await supabase
        .from("jobs")
        .update({ last_seen_at: new Date().toISOString(), likely_expired: false })
        .eq("id", matchedJobId);
      return { outcome: "linked_existing", jobId: matchedJobId };
    }
  }

  const { locationType, remoteFlag } = classifyLocation(location);

  const { data: inserted, error } = await supabase
    .from("jobs")
    .insert({
      source_id: null,
      external_id: null,
      company,
      title,
      location,
      location_type: locationType,
      remote_flag: remoteFlag,
      description_raw: input.descriptionRaw?.trim() || "",
      description_url: input.url,
      posted_at: null,
      dedupe_hash: dedupeHash,
      entry_method: "manual",
      raw_payload: null,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    throw new Error(error?.message ?? "Failed to insert manual job");
  }

  return { outcome: "inserted_new", jobId: inserted.id as string };
}
