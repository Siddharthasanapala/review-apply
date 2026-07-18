import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractProfile } from "@/lib/gemini/extractProfile";
import { embedText } from "@/lib/gemini/embedText";

export type ProfileDocumentType = "resume" | "portfolio" | "cover_letter_sample";

/**
 * Design decision (specs/DECISIONS.md): the resume row is the canonical
 * "effective" profile — its `parsed_skills` is what Settings displays and
 * what the user edits, and what Phase 4 matching reads. Portfolio text is
 * still extracted and embedded into its own row (for history and its own
 * embedding), but its skills are MERGED (union, never overwrite) into the
 * current resume row rather than living as a separate competing list —
 * this satisfies phase-03-profile-ingestion.md's "resume/portfolio
 * disagree -> merge, don't overwrite; surface the union to the user."
 */

function unionSkills(existing: string[], incoming: string[]): string[] {
  const seen = new Map<string, string>();
  for (const skill of existing) seen.set(skill.trim().toLowerCase(), skill.trim());
  for (const skill of incoming) {
    const key = skill.trim().toLowerCase();
    if (key && !seen.has(key)) seen.set(key, skill.trim());
  }
  return [...seen.values()];
}

export async function getLatestProfileDocument(
  supabase: SupabaseClient,
  userId: string,
  type: ProfileDocumentType,
) {
  const { data } = await supabase
    .from("profile_documents")
    .select("*")
    .eq("user_id", userId)
    .eq("type", type)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function nextVersionNumber(
  supabase: SupabaseClient,
  userId: string,
  type: ProfileDocumentType,
): Promise<number> {
  const latest = await getLatestProfileDocument(supabase, userId, type);
  return (latest?.version_number ?? 0) + 1;
}

export interface SaveDocumentResult {
  ok: boolean;
  documentId?: string;
  extractionError?: string;
  embeddingError?: string;
}

export async function saveResumeDocument(
  supabase: SupabaseClient,
  userId: string,
  rawText: string,
  storagePath: string | null,
): Promise<SaveDocumentResult> {
  const extraction = await extractProfile(rawText);
  const embedding = await embedText(rawText);

  const skills = extraction.ok ? extraction.profile.skills : [];

  // Merge in the current portfolio's skills, if one exists (union, never overwrite).
  const existingPortfolio = await getLatestProfileDocument(supabase, userId, "portfolio");
  const mergedSkills = existingPortfolio?.parsed_skills
    ? unionSkills(skills, existingPortfolio.parsed_skills as string[])
    : skills;

  const version = await nextVersionNumber(supabase, userId, "resume");

  const { data, error } = await supabase
    .from("profile_documents")
    .insert({
      user_id: userId,
      type: "resume",
      raw_text: rawText,
      storage_path: storagePath,
      parsed_skills: mergedSkills,
      embedding: embedding.ok ? embedding.embedding : null,
      version_number: version,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, extractionError: error?.message ?? "insert failed" };
  }

  return {
    ok: true,
    documentId: data.id as string,
    extractionError: extraction.ok ? undefined : extraction.error,
    embeddingError: embedding.ok ? undefined : embedding.error,
  };
}

export async function savePortfolioDocument(
  supabase: SupabaseClient,
  userId: string,
  rawText: string,
  sourceUrl: string,
): Promise<SaveDocumentResult> {
  const extraction = await extractProfile(rawText);
  const embedding = await embedText(rawText);

  const skills = extraction.ok ? extraction.profile.skills : [];
  const version = await nextVersionNumber(supabase, userId, "portfolio");

  const { data, error } = await supabase
    .from("profile_documents")
    .insert({
      user_id: userId,
      type: "portfolio",
      raw_text: rawText,
      storage_path: sourceUrl,
      parsed_skills: skills,
      embedding: embedding.ok ? embedding.embedding : null,
      version_number: version,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, extractionError: error?.message ?? "insert failed" };
  }

  // Merge this portfolio's skills into the current resume (union, not overwrite).
  const currentResume = await getLatestProfileDocument(supabase, userId, "resume");
  if (currentResume) {
    const merged = unionSkills((currentResume.parsed_skills as string[] | null) ?? [], skills);
    await supabase.from("profile_documents").update({ parsed_skills: merged }).eq("id", currentResume.id);
  }

  return {
    ok: true,
    documentId: data.id as string,
    extractionError: extraction.ok ? undefined : extraction.error,
    embeddingError: embedding.ok ? undefined : embedding.error,
  };
}

/** User corrections to the effective skill list always land on the current
 * resume row, overriding whatever the LLM/merge produced — user edits win. */
export async function updateEffectiveSkills(
  supabase: SupabaseClient,
  userId: string,
  skills: string[],
): Promise<{ ok: boolean; error?: string }> {
  const currentResume = await getLatestProfileDocument(supabase, userId, "resume");
  if (!currentResume) {
    return { ok: false, error: "No resume uploaded yet" };
  }

  const { error } = await supabase
    .from("profile_documents")
    .update({ parsed_skills: skills })
    .eq("id", currentResume.id);

  return error ? { ok: false, error: error.message } : { ok: true };
}
