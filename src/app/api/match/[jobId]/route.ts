import { auth } from "@/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { checkAndBumpGeminiQuota } from "@/lib/gemini/quota";
import { ensureJobEmbedding, getProfileForMatching, scoreJob, type JobForMatching } from "@/lib/matching/scoreJob";

const MAX_CALLS_PER_DAY = 100;

// Session-auth on-demand match — e.g. a "Match this job now" button so
// the user isn't stuck waiting for the next cron cycle to see a score on
// a job they just pasted in. No embedding pre-filter here (spec: "the
// cost tradeoff only matters at batch volume") — one job, one call.
export async function POST(request: Request, ctx: RouteContext<"/api/match/[jobId]">) {
  const session = await auth();
  if (!session?.user?.email) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = await ctx.params;

  const supabase = getSupabaseServerClient();
  const { data: userRow } = await supabase.from("users").select("id").eq("email", session.user.email).single();
  if (!userRow) {
    return Response.json({ error: "User not found" }, { status: 500 });
  }
  const userId = userRow.id as string;

  const profile = await getProfileForMatching(supabase, userId);
  if (!profile) {
    return Response.json({ error: "No resume uploaded yet — nothing to match against" }, { status: 400 });
  }

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id, title, company, location, description_raw, embedding, entry_method, source_id")
    .eq("id", jobId)
    .single();

  if (jobError || !job) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }

  const quotaOk = await checkAndBumpGeminiQuota(supabase, "matching", MAX_CALLS_PER_DAY);
  if (!quotaOk) {
    return Response.json({ error: "Daily matching quota reached — try again tomorrow" }, { status: 429 });
  }

  let sourceType: string | null = null;
  if (job.source_id) {
    const { data: source } = await supabase.from("job_sources").select("type").eq("id", job.source_id).single();
    sourceType = (source?.type as string | null) ?? null;
  }

  // Embedding still generated/cached for future batch runs, just not used
  // to gate whether this on-demand call happens. job.embedding is the raw
  // Supabase value (a string, not an array — see parseEmbedding.ts);
  // ensureJobEmbedding parses it internally.
  const embedding = await ensureJobEmbedding(
    supabase,
    job.id,
    job.embedding,
    job.title as string,
    (job.description_raw as string | null) ?? "",
  );

  const jobForMatching: JobForMatching = {
    id: job.id as string,
    title: job.title as string,
    company: job.company as string,
    location: job.location as string | null,
    descriptionRaw: (job.description_raw as string | null) ?? "",
    embedding,
    entryMethod: job.entry_method as string,
    sourceType,
  };

  const outcome = await scoreJob(supabase, userId, jobForMatching, profile);

  if (outcome === "match_failed") {
    return Response.json({ error: "Matching failed — see admin view for details" }, { status: 500 });
  }

  return Response.json({ outcome });
}
