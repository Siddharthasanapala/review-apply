import "server-only";
import { getGeminiClient, EXTRACTION_MODEL } from "./client";
import { retryWithBackoff } from "./retryWithBackoff";

export interface ExtractedProfile {
  skills: string[];
  experienceSummary: string;
  yearsExperienceByDomain: Record<string, number>;
  notableProjects: string[];
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    skills: {
      type: "array",
      items: { type: "string" },
      description: "Flat list of distinct skills/technologies/tools mentioned or clearly implied.",
    },
    experienceSummary: {
      type: "string",
      description: "2-4 sentence neutral summary of the person's professional background.",
    },
    yearsExperienceByDomain: {
      type: "object",
      description:
        "Map of domain/skill-area name (e.g. 'backend', 'frontend', 'data engineering') to estimated years of experience in that area, based only on what's stated or clearly derivable from dates in the text.",
      additionalProperties: { type: "number" },
    },
    notableProjects: {
      type: "array",
      items: { type: "string" },
      description: "Short descriptions of notable projects mentioned in the text.",
    },
  },
  required: ["skills", "experienceSummary", "yearsExperienceByDomain", "notableProjects"],
};

const PROMPT_PREFIX = `You are extracting structured information from a person's own resume or portfolio text, for their personal use in a job-matching tool they run themselves.

Extract ONLY what is stated or very clearly implied by the text below. Do not invent skills, years of experience, or projects that aren't supported by the text. If something is genuinely unclear, omit it rather than guessing.

Text:
---
`;

export type ExtractProfileResult =
  | { ok: true; profile: ExtractedProfile }
  | { ok: false; error: string };

/**
 * Structured extraction with retry-with-backoff (CONSTITUTION.md §4) —
 * schema-validated, retried on malformed JSON or transient API errors
 * (including rate limits) with exponential delay between attempts.
 */
export async function extractProfile(text: string): Promise<ExtractProfileResult> {
  const client = getGeminiClient();
  if (!client) {
    return { ok: false, error: "GEMINI_API_KEY not configured" };
  }

  try {
    const profile = await retryWithBackoff(async () => {
      const response = await client.models.generateContent({
        model: EXTRACTION_MODEL,
        contents: PROMPT_PREFIX + text,
        config: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      });

      const raw = response.text;
      if (!raw) throw new Error("empty response");

      const parsed = JSON.parse(raw) as ExtractedProfile;
      if (
        !Array.isArray(parsed.skills) ||
        typeof parsed.experienceSummary !== "string" ||
        typeof parsed.yearsExperienceByDomain !== "object" ||
        !Array.isArray(parsed.notableProjects)
      ) {
        throw new Error("response did not match expected shape");
      }

      return parsed;
    });

    return { ok: true, profile };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Extraction failed" };
  }
}
