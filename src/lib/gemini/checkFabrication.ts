import "server-only";
import { getGeminiClient, EXTRACTION_MODEL } from "./client";
import { retryWithBackoff } from "./retryWithBackoff";

export interface FabricationFlag {
  claim: string;
  reason: string;
}

export type CheckFabricationResult = { ok: true; flags: FabricationFlag[] } | { ok: false; error: string };

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    flags: {
      type: "array",
      description: "Every factual claim in the tailored resume that cannot be verified against the base resume. Empty array if none found.",
      items: {
        type: "object",
        properties: {
          claim: { type: "string", description: "The specific claim in the tailored text (company, title, date range, degree, certification, or a skill claimed as used professionally)." },
          reason: { type: "string", description: "Why this can't be verified against the base resume." },
        },
        required: ["claim", "reason"],
      },
    },
  },
  required: ["flags"],
};

/**
 * A SEPARATE, adversarial Gemini call — not string-diffing, since a
 * rephrased fabrication won't show up as a text diff (phase-05-drafting.md
 * "Fabrication risk" edge case, the single biggest risk in this phase).
 * Deliberately skeptical framing, different prompt from the drafting call,
 * so it isn't just agreeing with its own output.
 */
export async function checkFabrication(
  baseResumeText: string,
  tailoredResumeText: string,
): Promise<CheckFabricationResult> {
  const client = getGeminiClient();
  if (!client) {
    return { ok: false, error: "GEMINI_API_KEY not configured" };
  }

  const prompt = `You are a skeptical fact-checker reviewing a "tailored" version of someone's resume against their original. Assume the tailored version MAY contain fabrications — invented companies, titles, date ranges, degrees, certifications, or skills claimed as "used professionally" that aren't actually supported by the original. Your job is to find them, not to agree with the edit.

For every factual claim in the tailored version, verify it appears — in substance, not necessarily verbatim — in the original. Flag anything you cannot verify. Do not flag stylistic rephrasing, bullet reordering, or emphasis changes that don't introduce a new factual claim.

Original resume:
---
${baseResumeText}
---

Tailored version to check:
---
${tailoredResumeText}
---`;

  try {
    const flags = await retryWithBackoff(async () => {
      const response = await client.models.generateContent({
        model: EXTRACTION_MODEL,
        contents: prompt,
        config: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
      });

      const raw = response.text;
      if (!raw) throw new Error("empty response");

      const parsed = JSON.parse(raw) as { flags: FabricationFlag[] };
      if (!Array.isArray(parsed.flags)) {
        throw new Error("response did not match expected shape");
      }

      return parsed.flags;
    });

    return { ok: true, flags };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Fabrication check failed" };
  }
}
