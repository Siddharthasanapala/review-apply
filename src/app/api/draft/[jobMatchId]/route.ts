import { auth } from "@/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { draftApplication, type DraftInput } from "@/lib/drafting/draftApplication";

// Session-auth on-demand drafting — lets the user manually trigger a
// draft for a below-threshold job they're still curious about
// (phase-05-drafting.md "Rate/cost control" edge case), rather than
// drafting everything automatically.
export async function POST(request: Request, ctx: RouteContext<"/api/draft/[jobMatchId]">) {
  const session = await auth();
  if (!session?.user?.email) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobMatchId } = await ctx.params;

  const supabase = getSupabaseServerClient();
  const { data: userRow } = await supabase.from("users").select("id").eq("email", session.user.email).single();
  if (!userRow) {
    return Response.json({ error: "User not found" }, { status: 500 });
  }
  const userId = userRow.id as string;

  const { data: match, error: matchError } = await supabase
    .from("job_matches")
    .select("id, job_id, user_id, profile_version, matched_skills, missing_skills")
    .eq("id", jobMatchId)
    .single();

  if (matchError || !match || match.user_id !== userId) {
    return Response.json({ error: "Match not found" }, { status: 404 });
  }

  const { data: job } = await supabase
    .from("jobs")
    .select("title, company, description_raw")
    .eq("id", match.job_id)
    .single();

  if (!job) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }

  const { data: resume } = await supabase
    .from("profile_documents")
    .select("*")
    .eq("user_id", userId)
    .eq("type", "resume")
    .eq("version_number", match.profile_version)
    .maybeSingle();

  if (!resume) {
    return Response.json({ error: "Profile version used for this match is no longer available" }, { status: 400 });
  }

  const input: DraftInput = {
    jobMatchId: match.id as string,
    profileVersion: match.profile_version as number,
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

  if (outcome === "failed") {
    return Response.json({ error: "Drafting failed" }, { status: 500 });
  }

  return Response.json({ outcome });
}
