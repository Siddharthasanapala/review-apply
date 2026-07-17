import { verifyCronSecret } from "@/lib/cron/verifyCronSecret";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { createGreenhouseAdapter, type GreenhouseConfig } from "@/lib/sources/greenhouse";
import { createAdzunaAdapter, type AdzunaConfig } from "@/lib/sources/adzuna";
import { checkAndBumpQuota } from "@/lib/jobs/quota";
import { upsertIngestedJobsBatch } from "@/lib/jobs/ingestJob";
import type { JobSourceAdapter, RawListing } from "@/lib/sources/types";
import type { SupabaseClient } from "@supabase/supabase-js";

// Vercel Hobby caps functions at 10s by default; 60 is the max Hobby
// allows. Greenhouse/Adzuna can each make dozens of outbound requests in
// one run (one per company, or one per country x query), so the default
// isn't enough headroom.
export const maxDuration = 60;

interface SourceRow {
  id: string;
  name: string;
  type: string;
  base_config: Record<string, unknown>;
  enabled: boolean;
}

interface SourceRunSummary {
  fetched: number;
  inserted: number;
  linked: number;
  updated: number;
  error?: string;
}

const STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000;

// Idempotent and safe to re-run: every source's listings are upserted on
// (source_id, external_id) in bulk, never blindly appended.
export async function POST(request: Request) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseServerClient();

  const { data: sources, error: sourcesError } = await supabase
    .from("job_sources")
    .select("id, name, type, base_config, enabled")
    .eq("enabled", true)
    .neq("type", "manual");

  if (sourcesError) {
    return Response.json({ error: sourcesError.message }, { status: 500 });
  }

  const results: Record<string, SourceRunSummary> = {};
  const polledSourceIds: string[] = [];

  for (const source of (sources ?? []) as SourceRow[]) {
    const summary: SourceRunSummary = { fetched: 0, inserted: 0, linked: 0, updated: 0 };

    try {
      const adapter = buildAdapter(source, supabase);
      if (!adapter) {
        results[source.name] = { ...summary, error: "adapter unavailable (missing config/keys)" };
        continue;
      }

      const rawListings = await adapter.fetchListings();
      const deduped = dedupeByExternalId(rawListings);
      summary.fetched = deduped.length;

      const normalized = deduped.map((raw) => adapter.normalize(raw));
      const batchResult = await upsertIngestedJobsBatch(supabase, source.id, normalized);

      summary.inserted = batchResult.inserted;
      summary.linked = batchResult.linked;
      summary.updated = batchResult.updated;

      polledSourceIds.push(source.id);
      results[source.name] = summary;
    } catch (err) {
      // One source's failure must not block the others.
      results[source.name] = {
        ...summary,
        error: err instanceof Error ? err.message : "unknown error",
      };
    }
  }

  if (polledSourceIds.length > 0) {
    const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();
    await supabase
      .from("jobs")
      .update({ likely_expired: true })
      .in("source_id", polledSourceIds)
      .eq("likely_expired", false)
      .lt("last_seen_at", staleThreshold);
  }

  return Response.json({ ranAt: new Date().toISOString(), results });
}

function dedupeByExternalId(listings: RawListing[]): RawListing[] {
  const map = new Map<string, RawListing>();
  for (const listing of listings) map.set(listing.externalId, listing);
  return [...map.values()];
}

function buildAdapter(source: SourceRow, supabase: SupabaseClient): JobSourceAdapter | null {
  switch (source.name) {
    case "greenhouse":
      return createGreenhouseAdapter(source.base_config as unknown as GreenhouseConfig);
    case "adzuna":
      return createAdzunaAdapter(source.base_config as unknown as AdzunaConfig, () =>
        checkAndBumpQuota(supabase, source),
      );
    default:
      return null;
  }
}
