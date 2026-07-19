import "server-only";
import { GoogleGenAI } from "@google/genai";

/**
 * Model choices (documented in specs/DECISIONS.md):
 * - EXTRACTION_MODEL: flash-tier — structured extraction runs rarely (only
 *   on resume/portfolio upload), so cost isn't the driver, but flash-tier
 *   quality is sufficient for this task and keeps things cheap by default.
 * - MATCHING_MODEL: flash-lite — matching runs at BATCH volume across
 *   every ingested job, and real testing found EXTRACTION_MODEL
 *   ("gemini-flash-latest", resolving to gemini-3.5-flash) has a free-tier
 *   cap of just 5 requests/minute — too tight for batch scoring. Flash-lite
 *   has a more generous free-tier RPM/RPD, better suited to this volume.
 * - EMBEDDING_MODEL: gemini-embedding-2, recommended for semantic
 *   similarity use cases, 8192 token input limit (fits full resumes).
 */
export const EXTRACTION_MODEL = "gemini-flash-latest";
export const MATCHING_MODEL = "gemini-flash-lite-latest";
export const EMBEDDING_MODEL = "gemini-embedding-2";
export const EMBEDDING_DIMENSIONS = 768;

let client: GoogleGenAI | null = null;

/** Returns null (rather than throwing) when GEMINI_API_KEY isn't set, so
 * callers can degrade gracefully instead of crashing routes that don't
 * strictly require boot-time validation of this key (see lib/env.ts note
 * on why this key isn't in the required-at-boot schema). */
export function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}
