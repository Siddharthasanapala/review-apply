import { verifyCronOrSession } from "@/lib/cron/verifyCronOrSession";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { draftApplication, type DraftInput } from "@/lib/drafting/draftApplication";

export const maxDuration = 60;

// Drafting makes 4 Gemini calls per job (tailor, fabrication critic, cover
// letter, screening answers — sometimes 5 if the cover letter needs a
// stricter regen). Real testing measured ~33s for one job's full pipeline
// — 2 per run would risk exceeding Vercel's 60s limit, so capped at 1.
const MAX_DRAFTS_PER_RUN = 1;

export async function POST(request: Request) {
  const unauthorized = await verifyCronOrSession(request);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseServerClient();

  const userQuery = supabase.from("users").select("id, settings");
  const { data: userRow } = env.ALLOWED_USER_EMAIL
    ? await userQuery.eq("email", env.ALLOWED_USER_EMAIL).single()
    : await userQuery.limit(1).single();

  if (!userRow) {
    return Response.json({ error: "No user found" }, { status: 500 });
  }
  const userId = userRow.id as string;
  const threshold = ((userRow.settings as Record<string, unknown> | null)?.matchThreshold as number | undefined) ?? 70;

  const { data: resume } = await supabase
    .from("profile_documents")
    .select("*")
    .eq("user_id", userId)
    .eq("type", "resume")
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!resume) {
    return Response.json({ error: "No resume uploaded yet — nothing to draft from" }, { status: 200 });
  }

  const { data: matches } = await supabase
    .from("job_matches")
    .select("id, job_id, score, matched_skills, missing_skills")
    .eq("profile_version", resume.version_number)
    .eq("status", "new")
    .gte("score", threshold);

  const summary = { eligible: matches?.length ?? 0, drafted: 0, failed: 0 };
  const toProcess = (matches ?? []).slice(0, MAX_DRAFTS_PER_RUN);

  for (const match of toProcess) {
    const { data: job } = await supabase
      .from("jobs")
      .select("title, company, description_raw")
      .eq("id", match.job_id)
      .single();

    if (!job) {
      summary.failed++;
      continue;
    }

    const input: DraftInput = {
      jobMatchId: match.id as string,
      profileVersion: resume.version_number as number,
      jobTitle: job.title as string,
      company: job.company as string,
      descriptionRaw: (job.description_raw as string | null) ?? "",
      matchedSkills: (match.matched_skills as string[] | null) ?? [],
      missingSkills: (match.missing_skills as string[] | null) ?? [],
      baseResumeText: (resume.raw_text as string | null) ?? "",
      profileSkills: (resume.parsed_skills as string[] | null) ?? [],
      experienceSummary: (resume.experience_summary as string | null) ?? "",
      yearsExperienceByDomain: (resume.years_experience_by_domain as Record<string, number> | null) ?? {},
      notableProjects: (resume.notable_projects as string[] | null) ?? [],
    };

    const outcome = await draftApplication(supabase, input);
    if (outcome === "drafted") summary.drafted++;
    else summary.failed++;
  }

  return Response.json({ ranAt: new Date().toISOString(), threshold, summary });
}
