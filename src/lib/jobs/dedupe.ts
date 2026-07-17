import { createHash } from "node:crypto";

/**
 * Fuzzy company+title+location key used ONLY to link likely-duplicate
 * postings across sources (job_source_links) — never to collapse/merge
 * `jobs` rows outright. See specs/DECISIONS.md for why: two genuinely
 * distinct concurrent reqs with identical title/company/location (common
 * with high-volume recruiters) must stay as separate rows.
 */
export function computeDedupeHash(
  company: string,
  title: string,
  location: string | null | undefined,
): string {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");

  const key = [normalize(company), normalize(title), normalize(location ?? "")].join("|");
  return createHash("sha256").update(key).digest("hex");
}
