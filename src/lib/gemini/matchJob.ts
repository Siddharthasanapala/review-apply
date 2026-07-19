import "server-only";
import { getGeminiClient, MATCHING_MODEL } from "./client";
import { retryWithBackoff } from "./retryWithBackoff";

export interface MatchInput {
  jobTitle: string;
  company: string;
  location: string | null;
  descriptionRaw: string;
  profileSkills: string[];
  experienceSummary: string;
  yearsExperienceByDomain: Record<string, number>;
  notableProjects: string[];
}

export interface MatchResult {
  score: number;
  rationale: string;
  matchedSkills: string[];
  missingSkills: string[];
  seniorityFit: "under-qualified" | "good-fit" | "over-qualified";
  flags: string[];
}

export type MatchJobResult = { ok: true; match: MatchResult } | { ok: false; error: string };

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer", description: "0-100 fit score." },
    rationale: {
      type: "string",
      description:
        "2-4 sentences grounding the score in specific evidence from BOTH the job description and the profile — cite concrete requirements vs concrete experience, not a vibe score. If the JD is too vague/short to assess confidently, say so explicitly here instead of giving a falsely precise score.",
    },
    matchedSkills: { type: "array", items: { type: "string" } },
    missingSkills: { type: "array", items: { type: "string" } },
    seniorityFit: {
      type: "string",
      enum: ["under-qualified", "good-fit", "over-qualified"],
      description:
        "Judge actual seniority/depth fit, not just keyword overlap — e.g. both mentioning 'Python' doesn't mean the seniority level matches.",
    },
    flags: {
      type: "array",
      items: { type: "string" },
      description:
        "Anything the user should see before investing review time: requirements unverifiable from a resume alone (security clearance, work authorization, a specific certification), or anything else notable. Empty array if none.",
    },
  },
  required: ["score", "rationale", "matchedSkills", "missingSkills", "seniorityFit", "flags"],
};

const PROMPT_PREFIX = `You are scoring how well a job posting fits a candidate's profile, for the candidate's own personal job-search tool.

Ground your score in specific evidence from both the job description and the profile. Do not give a high score just because a keyword appears in both — judge actual depth/seniority fit. If the job description is too vague or short to assess confidently, say so explicitly in the rationale and reflect that uncertainty in the score rather than presenting a falsely precise number. If the posting requires something that can't be verified from a resume alone (security clearance, specific work authorization, a named certification), add it to flags rather than silently scoring it down.

Job posting:
---
Title: `;

export async function matchJob(input: MatchInput): Promise<MatchJobResult> {
  const client = getGeminiClient();
  if (!client) {
    return { ok: false, error: "GEMINI_API_KEY not configured" };
  }

  const prompt =
    PROMPT_PREFIX +
    `${input.jobTitle}
Company: ${input.company}
Location: ${input.location ?? "unspecified"}
Description:
${input.descriptionRaw}
---

Candidate profile:
---
Skills: ${input.profileSkills.join(", ") || "(none listed)"}
Experience summary: ${input.experienceSummary || "(none available)"}
Years of experience by domain: ${JSON.stringify(input.yearsExperienceByDomain)}
Notable projects: ${input.notableProjects.join("; ") || "(none listed)"}
---`;

  try {
    const parsed = await retryWithBackoff(async () => {
      const response = await client.models.generateContent({
        model: MATCHING_MODEL,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      });

      const raw = response.text;
      if (!raw) throw new Error("empty response");

      const result = JSON.parse(raw) as {
        score: number;
        rationale: string;
        matchedSkills: string[];
        missingSkills: string[];
        seniorityFit: string;
        flags: string[];
      };

      if (
        typeof result.score !== "number" ||
        typeof result.rationale !== "string" ||
        !Array.isArray(result.matchedSkills) ||
        !Array.isArray(result.missingSkills) ||
        !["under-qualified", "good-fit", "over-qualified"].includes(result.seniorityFit) ||
        !Array.isArray(result.flags)
      ) {
        throw new Error("response did not match expected shape");
      }

      return result as MatchResult;
    });

    return { ok: true, match: parsed };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Matching failed" };
  }
}
