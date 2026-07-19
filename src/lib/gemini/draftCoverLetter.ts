import "server-only";
import { getGeminiClient, MATCHING_MODEL } from "./client";
import { retryWithBackoff } from "./retryWithBackoff";

export type DraftCoverLetterResult = { ok: true; coverLetterText: string } | { ok: false; error: string };

function buildPrompt(strict: boolean, company: string, jobTitle: string, descriptionRaw: string, matchedSkills: string[], notableProjects: string[]): string {
  const base = `Write a cover letter for this candidate applying to the role below, for the candidate's own personal use.

Requirements:
- 250-350 words.
- Reference the company name "${company}" explicitly and at least one specific detail from the job description below — not generic filler that could apply to any company.
- Reference 2-3 concrete matched skills or projects from the candidate's background, specifically.
- Do not invent experience — only use what's given below.
- No placeholder brackets like "[Company Name]" — use the real values given.`;

  const strictAddendum = strict
    ? `\n\nIMPORTANT: A previous attempt at this was too generic (didn't clearly reference "${company}" or a specific JD detail). Be explicit and concrete this time — name the company, quote or closely paraphrase a specific requirement from the description, and connect it directly to the candidate's matched skills/projects.`
    : "";

  return `${base}${strictAddendum}

Job posting:
---
Title: ${jobTitle}
Company: ${company}
Description: ${descriptionRaw}
---

Candidate's matched skills: ${matchedSkills.join(", ") || "(none listed)"}
Candidate's notable projects: ${notableProjects.join("; ") || "(none listed)"}

Return only the cover letter text, no preamble.`;
}

/** Checks the company name appears in the letter — a cheap, verifiable
 * proxy for "not generic" (phase-05-drafting.md "Cover letter genericness"
 * edge case) rather than a vibe judgment. */
function looksGeneric(text: string, company: string): boolean {
  return !text.toLowerCase().includes(company.toLowerCase());
}

export async function draftCoverLetter(
  company: string,
  jobTitle: string,
  descriptionRaw: string,
  matchedSkills: string[],
  notableProjects: string[],
): Promise<DraftCoverLetterResult> {
  const client = getGeminiClient();
  if (!client) {
    return { ok: false, error: "GEMINI_API_KEY not configured" };
  }

  try {
    let text = await retryWithBackoff(async () => {
      const response = await client.models.generateContent({
        model: MATCHING_MODEL,
        contents: buildPrompt(false, company, jobTitle, descriptionRaw, matchedSkills, notableProjects),
      });
      const raw = response.text;
      if (!raw) throw new Error("empty response");
      return raw.trim();
    });

    if (looksGeneric(text, company)) {
      text = await retryWithBackoff(async () => {
        const response = await client.models.generateContent({
          model: MATCHING_MODEL,
          contents: buildPrompt(true, company, jobTitle, descriptionRaw, matchedSkills, notableProjects),
        });
        const raw = response.text;
        if (!raw) throw new Error("empty response");
        return raw.trim();
      });
    }

    return { ok: true, coverLetterText: text };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Cover letter drafting failed" };
  }
}
