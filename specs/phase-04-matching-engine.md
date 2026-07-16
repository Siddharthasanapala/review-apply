# PHASE 4 — Matching Engine

## Goal
Every newly ingested job gets scored against the user's profile using
Gemini, with a numeric score, a human-readable rationale, and explicit
matched/missing skill lists.

## Tasks
1. Build `/api/match` (cron-callable, `CRON_SECRET`-gated), which:
   - Selects `jobs` not yet in `job_matches` for the current profile version
     (includes both auto-ingested and manually-entered jobs — matching
     doesn't care how a job got into the `jobs` table).
   - For each, calls Gemini with a structured-output prompt (see below).
   - Writes score + rationale + matched/missing skills to `job_matches`.
2. Also expose an on-demand match action from the UI (e.g. a "Match this
   job now" button on a freshly manually-entered job) so the user isn't
   stuck waiting for the next cron cycle to see a score on a job they just
   pasted in. Same underlying scoring function as the cron path, just
   triggered synchronously for one job instead of swept in batch.
3. Use embeddings (Phase 3) for a cheap pre-filter: compute cosine
   similarity between job description embedding and profile embedding;
   only send jobs above a low similarity floor to the (more expensive)
   Gemini structured-scoring call. This controls API cost as job volume
   grows. (Skip this pre-filter for the on-demand single-job path — the
   cost tradeoff only matters at batch volume.)
4. Score threshold for "notify me about this" is user-configurable in
   Settings (default e.g. 70/100).
5. Gemini prompt should require the model to ground its score in specific
   evidence from both the JD and the profile — not a vibe score. Ask for
   JSON output matching a fixed schema; validate the response against that
   schema and retry once on malformed output before failing the row.
6. Use the fast/cheap Gemini tier (Flash-class model) for matching — this
   runs at batch volume across every ingested job, so cost-per-call matters
   more than for drafting (Phase 5, lower volume, higher quality bar).
   Document the exact model name picked in `/specs/DECISIONS.md`.

## Example structured-output schema (illustrative, refine in build)
```json
{
  "score": 0-100,
  "rationale": "string, 2-4 sentences, cites specific JD requirements vs profile evidence",
  "matched_skills": ["string"],
  "missing_skills": ["string"],
  "seniority_fit": "under-qualified | good-fit | over-qualified",
  "flags": ["string, e.g. 'JD requires clearance user does not have'"]
}
```

## Edge cases to handle
- **Vague or very short JD text** (some postings are thin) — score with
  explicit low-confidence flag rather than a falsely precise number.
- **JD requires something unverifiable from resume alone** (security
  clearance, work authorization, specific certification) — surface as a
  `flags` entry so the user sees it before investing review time, don't
  silently score it down without explanation.
- **Gemini returns malformed JSON** — schema-validate; retry once; if it
  still fails, mark the match `status = 'match_failed'` and surface in an
  admin/debug view rather than crashing the pipeline for other jobs.
- **Score drift after profile edits** — if the user edits their resume/
  skills (Phase 3), previously scored jobs become stale. Either re-score
  jobs from the last N days on profile update, or clearly timestamp/label
  matches with which profile version produced them.
- **Cost control** — set a daily cap on Gemini calls for matching; if
  exceeded, queue remaining jobs for the next cycle rather than scoring
  everything unconditionally.
- **False positives from keyword overlap without real fit** (e.g., "Python"
  appears in both but at wildly different seniority) — this is why the
  rationale must cite seniority/depth, not just keyword presence; test this
  explicitly with a deliberately mismatched job during QA.

## Exit criteria checklist
- [ ] Embedding pre-filter implemented and reduces Gemini call volume measurably
- [ ] Structured JSON output validated against schema, with retry-once logic
- [ ] Score threshold configurable in Settings and respected downstream
- [ ] `flags` surfaced clearly in UI, not buried
- [ ] Malformed-response and cost-cap paths tested, not just happy path
- [ ] Manual QA: run against 5–10 real postings spanning clear match,
      clear non-match, and ambiguous cases; sanity-check rationale text
