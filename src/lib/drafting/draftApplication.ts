import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { tailorResume } from "@/lib/gemini/tailorResume";
import { checkFabrication } from "@/lib/gemini/checkFabrication";
import { draftCoverLetter } from "@/lib/gemini/draftCoverLetter";
import { draftScreeningAnswers } from "@/lib/gemini/draftScreeningAnswers";

export interface DraftInput {
  jobMatchId: string;
  profileVersion: number;
  jobTitle: string;
  company: string;
  descriptionRaw: string;
  matchedSkills: string[];
  missingSkills: string[];
  baseResumeText: string;
  profileSkills: string[];
  experienceSummary: string;
  yearsExperienceByDomain: Record<string, number>;
  notableProjects: string[];
}

export type DraftOutcome = "drafted" | "failed";

/**
 * Runs the full drafting pipeline for one job_match and upserts the
 * result into application_drafts. Used by both the batch cron sweep
 * (/api/draft) and the on-demand single-job path.
 *
 * Order matters: tailor first, then run the fabrication critic against
 * that specific output (not in parallel) — the critic call is deliberately
 * a SEPARATE Gemini call from tailoring, per phase-05-drafting.md, since
 * string-diffing can't catch a rephrased fabrication.
 */
export async function draftApplication(
  supabase: SupabaseClient,
  input: DraftInput,
): Promise<DraftOutcome> {
  const tailored = await tailorResume(
    input.baseResumeText,
    input.jobTitle,
    input.company,
    input.descriptionRaw,
    input.matchedSkills,
    input.missingSkills,
  );

  if (!tailored.ok) {
    return "failed";
  }

  const fabrication = await checkFabrication(input.baseResumeText, tailored.result.tailoredResumeText);
  const fabricationFlags = fabrication.ok ? fabrication.flags : [];

  const coverLetter = await draftCoverLetter(
    input.company,
    input.jobTitle,
    input.descriptionRaw,
    input.matchedSkills,
    input.notableProjects,
  );

  const screening = await draftScreeningAnswers(
    input.descriptionRaw,
    input.profileSkills,
    input.experienceSummary,
    input.yearsExperienceByDomain,
  );

  const { error } = await supabase.from("application_drafts").upsert(
    {
      job_match_id: input.jobMatchId,
      profile_version: input.profileVersion,
      tailored_resume_text: tailored.result.tailoredResumeText,
      resume_diff: tailored.result.changes,
      cover_letter_text: coverLetter.ok ? coverLetter.coverLetterText : null,
      screening_answers: screening.ok ? screening.result.answers : [],
      fabrication_flags: fabricationFlags,
      additional_materials_requested: screening.ok ? screening.result.additionalMaterialsRequested : [],
      status: "draft",
    },
    { onConflict: "job_match_id" },
  );

  if (error) return "failed";

  await supabase.from("job_matches").update({ status: "drafted" }).eq("id", input.jobMatchId);

  return "drafted";
}
