import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { matchJob } from "@/lib/gemini/matchJob";
import { embedText } from "@/lib/gemini/embedText";
import { parseEmbedding } from "./parseEmbedding";

export interface ProfileForMatching {
  version: number;
  skills: string[];
  experienceSummary: string;
  yearsExperienceByDomain: Record<string, number>;
  notableProjects: string[];
  embedding: number[] | null;
}

export interface JobForMatching {
  id: string;
  title: string;
  company: string;
  location: string | null;
  descriptionRaw: string;
  embedding: number[] | null;
  entryMethod: string;
  sourceType: string | null;
}

export type ScoreOutcome = "scored" | "match_failed" | "no_resume";

/**
 * Legitimacy flag (phase-04-matching-engine.md "Posting legitimacy" edge
 * case, user-raised 2026-07-17): official ATS postings are the company's
 * own system, inherently trustworthy. Aggregator and manually-entered
 * jobs aren't independently verified.
 */
function legitimacyFlag(job: JobForMatching): string | null {
  if (job.entryMethod === "manual") {
    return "Manually-entered posting — not independently verified. Confirm the company/posting is legitimate before applying.";
  }
  if (job.sourceType === "aggregator_api") {
    return "Aggregator-sourced posting — not independently verified. Confirm the company/posting is legitimate before applying.";
  }
  return null;
}

/**
 * Scores one job against the current profile and upserts the result into
 * job_matches. Used by both the batch cron sweep (/api/match) and the
 * on-demand single-job path — same function, same correctness guarantees,
 * just invoked differently.
 */
export async function scoreJob(
  supabase: SupabaseClient,
  userId: string,
  job: JobForMatching,
  profile: ProfileForMatching,
): Promise<ScoreOutcome> {
  const result = await matchJob({
    jobTitle: job.title,
    company: job.company,
    location: job.location,
    descriptionRaw: job.descriptionRaw,
    profileSkills: profile.skills,
    experienceSummary: profile.experienceSummary,
    yearsExperienceByDomain: profile.yearsExperienceByDomain,
    notableProjects: profile.notableProjects,
  });

  if (!result.ok) {
    await supabase.from("job_matches").upsert(
      {
        job_id: job.id,
        user_id: userId,
        profile_version: profile.version,
        status: "match_failed",
        error_text: result.error,
      },
      { onConflict: "job_id,profile_version" },
    );
    return "match_failed";
  }

  const flag = legitimacyFlag(job);
  const flags = flag ? [...result.match.flags, flag] : result.match.flags;

  await supabase.from("job_matches").upsert(
    {
      job_id: job.id,
      user_id: userId,
      profile_version: profile.version,
      score: result.match.score,
      rationale_text: result.match.rationale,
      matched_skills: result.match.matchedSkills,
      missing_skills: result.match.missingSkills,
      seniority_fit: result.match.seniorityFit,
      flags,
      status: "new",
      error_text: null,
    },
    { onConflict: "job_id,profile_version" },
  );

  return "scored";
}

export async function getProfileForMatching(
  supabase: SupabaseClient,
  userId: string,
): Promise<ProfileForMatching | null> {
  const { data: resume } = await supabase
    .from("profile_documents")
    .select("*")
    .eq("user_id", userId)
    .eq("type", "resume")
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!resume) return null;

  return {
    version: resume.version_number as number,
    skills: (resume.parsed_skills as string[] | null) ?? [],
    experienceSummary: (resume.experience_summary as string | null) ?? "",
    yearsExperienceByDomain: (resume.years_experience_by_domain as Record<string, number> | null) ?? {},
    notableProjects: (resume.notable_projects as string[] | null) ?? [],
    embedding: parseEmbedding(resume.embedding),
  };
}

/** Generates and persists a job's description embedding if it doesn't
 * have one yet (Phase 2 ingestion doesn't create these — done lazily here
 * so the embedding pre-filter has something to compare against).
 * `existingEmbedding` may be the raw value straight from a Supabase
 * select (string form) — always parsed here before use. */
export async function ensureJobEmbedding(
  supabase: SupabaseClient,
  jobId: string,
  existingEmbeddingRaw: unknown,
  title: string,
  descriptionRaw: string,
): Promise<number[] | null> {
  const existingEmbedding = parseEmbedding(existingEmbeddingRaw);
  if (existingEmbedding) return existingEmbedding;

  const result = await embedText(`${title}\n\n${descriptionRaw}`);
  if (!result.ok) return null;

  await supabase.from("jobs").update({ embedding: result.embedding }).eq("id", jobId);
  return result.embedding;
}
