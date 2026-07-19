import { verifyCronSecret } from "@/lib/cron/verifyCronSecret";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { checkAndBumpGeminiQuota } from "@/lib/gemini/quota";
import { cosineSimilarity } from "@/lib/matching/cosineSimilarity";
import {
  scoreJob,
  ensureJobEmbedding,
  getProfileForMatching,
  type JobForMatching,
} from "@/lib/matching/scoreJob";

export const maxDuration = 60;

// Cost-control knobs (phase-04-matching-engine.md edge cases). Real testing
// found gemini-flash-latest's free tier is just 5 RPM (far tighter than
// docs suggested) — one batch run hit RESOURCE_EXHAUSTED mid-sweep, which
// is why matching uses MATCHING_MODEL (flash-lite, ~15 RPM/1000 RPD) rather
// than EXTRACTION_MODEL. MAX_JOBS_PER_RUN also bounds wall-clock time:
// matching calls took 8-16s each in testing, so scoring everything in one
// run would blow past Vercel's 60s limit long before the daily quota would.
const MAX_CALLS_PER_DAY = 150;
const MAX_JOBS_PER_RUN = 5;
const SIMILARITY_FLOOR = 0.3;

interface JobRow {
  id: string;
  title: string;
  company: string;
  location: string | null;
  description_raw: string | null;
  // pgvector columns come back from Supabase as a string, not a parsed
  // array (see lib/matching/parseEmbedding.ts) — typed unknown here so
  // that fact can't get silently lost again.
  embedding: unknown;
  entry_method: string;
  source_id: string | null;
  likely_expired: boolean;
}

export async function POST(request: Request) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseServerClient();

  const userQuery = supabase.from("users").select("id");
  const { data: userRow } = env.ALLOWED_USER_EMAIL
    ? await userQuery.eq("email", env.ALLOWED_USER_EMAIL).single()
    : await userQuery.limit(1).single();

  if (!userRow) {
    return Response.json({ error: "No user found" }, { status: 500 });
  }
  const userId = userRow.id as string;

  const profile = await getProfileForMatching(supabase, userId);
  if (!profile) {
    return Response.json({ error: "No resume uploaded yet — nothing to match against" }, { status: 200 });
  }

  // match_failed rows are excluded from "already matched" so they get
  // retried next run — failures here are often transient (e.g. a rate
  // limit), and scoreJob's upsert (onConflict job_id,profile_version)
  // naturally overwrites a stale failure with a real result once it succeeds.
  const { data: alreadyMatched } = await supabase
    .from("job_matches")
    .select("job_id")
    .eq("profile_version", profile.version)
    .neq("status", "match_failed");
  const matchedIds = new Set((alreadyMatched ?? []).map((m) => m.job_id as string));

  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, title, company, location, description_raw, embedding, entry_method, source_id, likely_expired")
    .eq("likely_expired", false);

  const { data: sources } = await supabase.from("job_sources").select("id, type");
  const sourceTypeById = new Map((sources ?? []).map((s) => [s.id as string, s.type as string]));

  const candidates = ((jobs ?? []) as JobRow[]).filter((j) => !matchedIds.has(j.id));

  const summary = { fetched: candidates.length, scored: 0, skippedLowSimilarity: 0, failed: 0, quotaStopped: false };

  for (const job of candidates) {
    if (summary.scored + summary.failed >= MAX_JOBS_PER_RUN) break;

    const embedding = await ensureJobEmbedding(
      supabase,
      job.id,
      job.embedding,
      job.title,
      job.description_raw ?? "",
    );

    if (embedding && profile.embedding) {
      const similarity = cosineSimilarity(embedding, profile.embedding);
      if (similarity < SIMILARITY_FLOOR) {
        summary.skippedLowSimilarity++;
        continue;
      }
    }

    const quotaOk = await checkAndBumpGeminiQuota(supabase, "matching", MAX_CALLS_PER_DAY);
    if (!quotaOk) {
      summary.quotaStopped = true;
      break;
    }

    const jobForMatching: JobForMatching = {
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      descriptionRaw: job.description_raw ?? "",
      embedding,
      entryMethod: job.entry_method,
      sourceType: job.source_id ? (sourceTypeById.get(job.source_id) ?? null) : null,
    };

    const outcome = await scoreJob(supabase, userId, jobForMatching, profile);
    if (outcome === "scored") summary.scored++;
    else if (outcome === "match_failed") summary.failed++;
  }

  return Response.json({ ranAt: new Date().toISOString(), profileVersion: profile.version, summary });
}
