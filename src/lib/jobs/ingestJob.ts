import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeDedupeHash } from "@/lib/jobs/dedupe";
import type { NormalizedJob } from "@/lib/sources/types";

export interface BatchSummary {
  inserted: number;
  linked: number;
  updated: number;
}

const CHUNK_SIZE = 200;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function toRow(sourceId: string, job: NormalizedJob, now: string, dedupeHash: string) {
  return {
    source_id: sourceId,
    external_id: job.externalId,
    company: job.company,
    title: job.title,
    location: job.location,
    location_type: job.locationType,
    remote_flag: job.remoteFlag,
    description_raw: job.descriptionRaw,
    description_url: job.descriptionUrl,
    posted_at: job.postedAt,
    dedupe_hash: dedupeHash,
    entry_method: "auto",
    last_seen_at: now,
    likely_expired: false,
    raw_payload: job.raw as never,
  };
}

/**
 * Batch upsert for one source's full listing set in a single ingest run.
 * Real company data (Phase 2 verification) showed some ATS boards return
 * hundreds of listings per company; doing 2-4 sequential DB round trips
 * PER LISTING (the original per-row design) would take minutes and blow
 * past a serverless function's time limit. This does a constant number of
 * batched queries instead, chunked to keep any single request reasonably
 * sized (CHUNK_SIZE), regardless of how many listings come in.
 *
 * Same linking rules as before, just computed in bulk:
 * - (source_id, external_id) already exists as a primary row -> update it.
 * - (source_id, external_id) already exists as a job_source_links row ->
 *   bump the linked job's last_seen_at.
 * - Otherwise: look for an unambiguous (exactly one) dedupe_hash match on a
 *   DIFFERENT source -> link via job_source_links. Zero or 2+ matches ->
 *   insert as its own row (see specs/DECISIONS.md for why ambiguous cases
 *   are never guessed).
 */
export async function upsertIngestedJobsBatch(
  supabase: SupabaseClient,
  sourceId: string,
  jobs: NormalizedJob[],
): Promise<BatchSummary> {
  const summary: BatchSummary = { inserted: 0, linked: 0, updated: 0 };
  if (jobs.length === 0) return summary;

  const now = new Date().toISOString();

  const primarySet = new Set<string>();
  for (const idsChunk of chunk(jobs.map((j) => j.externalId), CHUNK_SIZE)) {
    const { data } = await supabase
      .from("jobs")
      .select("external_id")
      .eq("source_id", sourceId)
      .in("external_id", idsChunk);
    for (const row of data ?? []) primarySet.add(row.external_id as string);
  }

  const linkMap = new Map<string, string>();
  for (const idsChunk of chunk(jobs.map((j) => j.externalId), CHUNK_SIZE)) {
    const { data } = await supabase
      .from("job_source_links")
      .select("job_id, source_external_id")
      .eq("source_id", sourceId)
      .in("source_external_id", idsChunk);
    for (const row of data ?? []) {
      if (row.source_external_id) linkMap.set(row.source_external_id as string, row.job_id as string);
    }
  }

  const newListings = jobs
    .filter((j) => !primarySet.has(j.externalId) && !linkMap.has(j.externalId))
    .map((j) => ({ job: j, hash: computeDedupeHash(j.company, j.title, j.location) }));

  const hashMatchMap = new Map<string, string[]>();
  const uniqueHashes = [...new Set(newListings.map((n) => n.hash))];
  for (const hashesChunk of chunk(uniqueHashes, CHUNK_SIZE)) {
    if (hashesChunk.length === 0) continue;
    const { data } = await supabase
      .from("jobs")
      .select("id, dedupe_hash")
      .in("dedupe_hash", hashesChunk)
      .neq("source_id", sourceId);
    for (const row of data ?? []) {
      const hash = row.dedupe_hash as string;
      const list = hashMatchMap.get(hash) ?? [];
      list.push(row.id as string);
      hashMatchMap.set(hash, list);
    }
  }

  const upsertRows: ReturnType<typeof toRow>[] = [];
  const linkRows: Array<{ job_id: string; source_id: string; source_external_id: string; source_url: string }> = [];
  const touchIds = new Set<string>();

  for (const j of jobs) {
    if (primarySet.has(j.externalId)) {
      upsertRows.push(toRow(sourceId, j, now, computeDedupeHash(j.company, j.title, j.location)));
      summary.updated++;
    }
    const linkedJobId = linkMap.get(j.externalId);
    if (linkedJobId) {
      touchIds.add(linkedJobId);
      summary.updated++;
    }
  }

  for (const { job, hash } of newListings) {
    const matches = hashMatchMap.get(hash) ?? [];
    if (matches.length === 1) {
      linkRows.push({
        job_id: matches[0],
        source_id: sourceId,
        source_external_id: job.externalId,
        source_url: job.descriptionUrl,
      });
      touchIds.add(matches[0]);
      summary.linked++;
    } else {
      upsertRows.push(toRow(sourceId, job, now, hash));
      summary.inserted++;
    }
  }

  for (const rowsChunk of chunk(upsertRows, CHUNK_SIZE)) {
    if (rowsChunk.length === 0) continue;
    const { error } = await supabase
      .from("jobs")
      .upsert(rowsChunk, { onConflict: "source_id,external_id" });
    if (error) throw new Error(`Batch upsert failed: ${error.message}`);
  }

  for (const rowsChunk of chunk(linkRows, CHUNK_SIZE)) {
    if (rowsChunk.length === 0) continue;
    const { error } = await supabase.from("job_source_links").insert(rowsChunk);
    if (error) throw new Error(`Batch link insert failed: ${error.message}`);
  }

  for (const idsChunk of chunk([...touchIds], CHUNK_SIZE)) {
    if (idsChunk.length === 0) continue;
    await supabase
      .from("jobs")
      .update({ last_seen_at: now, likely_expired: false })
      .in("id", idsChunk);
  }

  return summary;
}
