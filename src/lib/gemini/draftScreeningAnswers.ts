import "server-only";
import { getGeminiClient, MATCHING_MODEL } from "./client";
import { retryWithBackoff } from "./retryWithBackoff";

export interface ScreeningAnswer {
  question: string;
  answer: string;
  isPlaceholder: boolean;
  placeholderReason?: string;
}

export interface ScreeningDraft {
  answers: ScreeningAnswer[];
  additionalMaterialsRequested: string[];
}

export type DraftScreeningAnswersResult = { ok: true; result: ScreeningDraft } | { ok: false; error: string };

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    answers: {
      type: "array",
      description: "Likely screening questions implied by the JD (years of experience, work authorization, salary, relocation, notice period, etc.) with draft answers from the profile data.",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          answer: { type: "string", description: "Draft answer from profile data, or a placeholder instruction if this requires a judgment call." },
          isPlaceholder: { type: "boolean", description: "True if this needs the candidate's own judgment call (salary expectation, willingness to relocate, work authorization, sponsorship) rather than a factual answer from the profile." },
          placeholderReason: { type: "string", description: "If isPlaceholder, why this can't be answered from profile data alone." },
        },
        required: ["question", "answer", "isPlaceholder"],
      },
    },
    additionalMaterialsRequested: {
      type: "array",
      items: { type: "string" },
      description: "Anything the JD asks applicants to submit that this app can't draft — a writing sample, references, a specific portfolio piece, etc. Empty array if none.",
    },
  },
  required: ["answers", "additionalMaterialsRequested"],
};

const PLACEHOLDER_TEXT = "[Fill in yourself — this requires your own judgment call]";

/** Keyword categories that must always be a placeholder, enforced in code
 * rather than trusted to the prompt alone (phase-05-drafting.md: "never
 * auto-filled... getting this wrong has real consequences"). */
const ALWAYS_PLACEHOLDER_PATTERNS = [
  /salary/i,
  /compensation/i,
  /pay\s*(range|expectation)/i,
  /work\s*authoriz/i,
  /sponsor/i,
  /visa/i,
  /relocat/i,
];

function forcePlaceholders(answers: ScreeningAnswer[]): ScreeningAnswer[] {
  return answers.map((a) => {
    const mustPlaceholder = ALWAYS_PLACEHOLDER_PATTERNS.some((re) => re.test(a.question));
    // Always overwrite the answer text for these categories, even when the
    // model already set isPlaceholder=true itself — real testing showed it
    // can mark a question as a placeholder but still write a "soft" answer
    // (a suggested deflection) rather than a hard fill-in instruction.
    // Given the spec's own words ("getting this wrong has real
    // consequences"), the text shown must be unmistakable every time, not
    // just when the model forgets to flag it.
    if (mustPlaceholder) {
      return {
        ...a,
        answer: PLACEHOLDER_TEXT,
        isPlaceholder: true,
        placeholderReason: "Salary/work-authorization/relocation questions are never auto-filled, regardless of model output.",
      };
    }
    return a;
  });
}

export async function draftScreeningAnswers(
  descriptionRaw: string,
  profileSkills: string[],
  experienceSummary: string,
  yearsExperienceByDomain: Record<string, number>,
): Promise<DraftScreeningAnswersResult> {
  const client = getGeminiClient();
  if (!client) {
    return { ok: false, error: "GEMINI_API_KEY not configured" };
  }

  const prompt = `Based on this job description, draft answers to the screening questions an applicant would likely be asked, using the candidate's profile data below.

Any question requiring a judgment call the candidate must make themselves — salary expectation, willingness to relocate, work authorization/visa sponsorship — must be marked isPlaceholder=true with an instructive answer, never guessed from profile data.

Job description:
---
${descriptionRaw}
---

Candidate profile:
---
Skills: ${profileSkills.join(", ") || "(none listed)"}
Experience summary: ${experienceSummary || "(none available)"}
Years of experience by domain: ${JSON.stringify(yearsExperienceByDomain)}
---`;

  try {
    const result = await retryWithBackoff(async () => {
      const response = await client.models.generateContent({
        model: MATCHING_MODEL,
        contents: prompt,
        config: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
      });

      const raw = response.text;
      if (!raw) throw new Error("empty response");

      const parsed = JSON.parse(raw) as ScreeningDraft;
      if (!Array.isArray(parsed.answers) || !Array.isArray(parsed.additionalMaterialsRequested)) {
        throw new Error("response did not match expected shape");
      }

      return parsed;
    });

    return { ok: true, result: { ...result, answers: forcePlaceholders(result.answers) } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Screening answer drafting failed" };
  }
}
