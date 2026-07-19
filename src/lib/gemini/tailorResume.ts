import "server-only";
import { getGeminiClient, EXTRACTION_MODEL } from "./client";
import { retryWithBackoff } from "./retryWithBackoff";

export interface ResumeChange {
  section: string;
  original: string;
  tailored: string;
  reason: string;
}

export interface TailoredResume {
  tailoredResumeText: string;
  changes: ResumeChange[];
}

export type TailorResumeResult = { ok: true; result: TailoredResume } | { ok: false; error: string };

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    tailoredResumeText: {
      type: "string",
      description: "The full resume text after applying the targeted edits — coherent and ready to use as-is.",
    },
    changes: {
      type: "array",
      description: "Every bullet-level edit made, for a redline view. Empty array if nothing was changed.",
      items: {
        type: "object",
        properties: {
          section: { type: "string", description: "Which resume section this edit is in, e.g. 'Experience' or 'Skills'." },
          original: { type: "string", description: "The original bullet/line before editing." },
          tailored: { type: "string", description: "The edited bullet/line." },
          reason: { type: "string", description: "Why this edit was made, tying it to the JD." },
        },
        required: ["section", "original", "tailored", "reason"],
      },
    },
  },
  required: ["tailoredResumeText", "changes"],
};

const PROMPT = `You are tailoring a candidate's resume for a specific job posting, for the candidate's own personal use.

Rules, strictly enforced:
- Only reorder bullets, adjust emphasis, and surface relevant keywords that are truthfully already supported by the base resume.
- NEVER invent or alter: company names, job titles, employment dates, degrees, certifications, or claim a skill/tool the candidate doesn't already list.
- Every edit must be traceable to something already true in the base resume — you are re-emphasizing existing truth, not adding new claims.
- If the base resume genuinely doesn't support closer alignment to the JD in some area, leave that alone rather than fabricating a connection.
- Return every edit you made in the changes list so the candidate can see exactly what changed and why. If you made no changes, return an empty array and the tailoredResumeText identical to the base resume.

Base resume:
---
`;

export async function tailorResume(
  baseResumeText: string,
  jobTitle: string,
  company: string,
  descriptionRaw: string,
  matchedSkills: string[],
  missingSkills: string[],
): Promise<TailorResumeResult> {
  const client = getGeminiClient();
  if (!client) {
    return { ok: false, error: "GEMINI_API_KEY not configured" };
  }

  const prompt =
    PROMPT +
    `${baseResumeText}
---

Job posting:
---
Title: ${jobTitle}
Company: ${company}
Description: ${descriptionRaw}
---

Skills already confirmed as matching (from a prior scoring pass): ${matchedSkills.join(", ") || "(none)"}
Skills the JD wants that the candidate doesn't have (do NOT add these): ${missingSkills.join(", ") || "(none)"}`;

  try {
    const result = await retryWithBackoff(async () => {
      const response = await client.models.generateContent({
        model: EXTRACTION_MODEL,
        contents: prompt,
        config: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
      });

      const raw = response.text;
      if (!raw) throw new Error("empty response");

      const parsed = JSON.parse(raw) as TailoredResume;
      if (typeof parsed.tailoredResumeText !== "string" || !Array.isArray(parsed.changes)) {
        throw new Error("response did not match expected shape");
      }

      return parsed;
    });

    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Resume tailoring failed" };
  }
}
