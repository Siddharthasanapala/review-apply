# PHASE 2 — Job Ingestion (Compliant Sources Only)

## Goal
A cron-triggered pipeline that pulls job postings from at least two
compliant sources, normalizes them to the common `Job` schema, dedupes, and
stores them — **plus** a manual-entry path so the user can paste in a job
(e.g. from LinkedIn) themselves. Zero LinkedIn scraping/automation — see
CONSTITUTION.md §1.

## Approved source categories (pick 2–4 to start)
1. **Company ATS public endpoints** — many companies expose their own job
   postings as public JSON with no auth required:
   - Greenhouse: `https://boards-api.greenhouse.io/v1/boards/{company}/jobs`
   - Lever: `https://api.lever.co/v0/postings/{company}?mode=json`
   - Ashby, SmartRecruiters, Workday also have public board endpoints —
     verify per-company since URLs vary.
   - You supply a watchlist of target companies (their careers pages tell
     you which ATS they use).
2. **Aggregator APIs** with terms permitting this use case — verify current
   terms before integrating, since pricing/limits/ToS change:
   - Adzuna API, JSearch (RapidAPI, aggregates multiple boards including
     public LinkedIn/Indeed listings through licensed access), Remotive,
     USAJobs (US government), Arbeitnow, TheMuse API.
3. **RSS/JSON feeds** a company or board publishes itself (e.g., some
   startups publish an RSS of open roles).
4. **Manual entry (user-supplied)** — a form where the user pastes a job
   posting's URL and description text themselves. This is not an
   "adapter" in the API-polling sense: no code fetches linkedin.com or any
   third-party page. The user reads the posting in their own browser and
   copies the text in. This is fully compliant (CONSTITUTION.md §1) and is
   the app's main way of covering LinkedIn-specific postings.

> Before wiring any specific aggregator, have the agent fetch and read that
> API's current terms-of-service page and pricing page, and summarize them
> back to the user before writing the integration. APIs and their terms
> change; do not rely on training-data assumptions about what's allowed.

## Tasks
1. Design `JobSourceAdapter` interface (see ARCHITECTURE.md §5).
2. Implement 2+ adapters (start with one ATS-style and one aggregator-style
   to prove the interface generalizes).
3. Build `jobs` + `job_source_links` table migrations + normalize/dedupe
   logic.
   - Primary uniqueness for auto-ingested jobs is `(source_id, external_id)`
     — upsert on that, never drop/merge rows on any other basis.
   - Separately compute a `dedupe_hash` (normalized company + title +
     location) purely to **link** rows that look like the same real-world
     posting across sources/entry methods into `job_source_links`. Never
     let the hash cause a row to be silently dropped — two concurrently
     open reqs with identical title/company/location (common with
     high-volume recruiters) must both remain visible as distinct `jobs`
     rows; only the "seen on N boards" linking uses fuzzy matching.
4. Build `/api/ingest` route (cron-triggered, `CRON_SECRET`-gated per
   ARCHITECTURE.md §7), that runs all enabled adapters and upserts results.
5. Build manual entry: a simple form (`/jobs/new`) + `POST /api/jobs/manual`
   (session-auth, not `CRON_SECRET` — this is a user-facing action, not a
   cron call) that takes `{ url, company, title, location, description_raw
   }`, runs it through the same normalize/dedupe-hash logic as auto-ingested
   jobs, sets `entry_method = 'manual'`, `source_id = NULL`, and inserts
   into `jobs`. It then flows through matching/drafting exactly like any
   other job — no special-casing downstream.
6. Add a `job_sources` admin table/UI toggle so sources can be enabled/
   disabled without a redeploy.
7. Rate-limit and backoff per adapter — respect each API's documented
   rate limits; do not hammer.

## Edge cases to handle
- **Duplicate postings across sources** — same job posted on 3 boards →
  dedupe hash must collapse them into one `jobs` row, but keep a
  `job_source_links` join table so you know all the places it was seen
  (useful when picking which link to send the user to apply from).
- **Stale/expired postings** — a source may not remove closed postings
  promptly. Add a `last_seen_at` field; if a job hasn't reappeared in N
  ingestion cycles, mark it `likely_expired` and hide it from the digest
  (don't delete — keep for history).
- **Malformed/partial data from a source** — missing salary, missing
  location, HTML-encoded description text. Sanitize HTML, store raw
  payload alongside normalized fields so nothing is silently lost.
- **Source API downtime or auth failure** — one failing source must not
  block ingestion of the others; log per-source failure, continue pipeline.
- **API quota exhaustion** — track calls per source per day; if nearing
  quota, degrade gracefully (skip low-priority sources) rather than error.
- **A company posts the "same" role repeatedly with tiny text changes**
  (common with high-volume recruiters) — fuzzy-match title+company+location
  before treating as a new posting, not just exact-hash.
- **Geography/remote ambiguity** — normalize "Remote (US)", "Remote", "Hybrid
  - NYC" into a consistent `location_type` enum plus free-text detail field.
- **Manually-entered job duplicates an auto-ingested one** — run the same
  dedupe-hash check on manual submits; if it matches an existing job, link
  via `job_source_links` and surface "this looks like a job you already
  have" rather than creating a redundant row.
- **Manual entry has messy pasted text** (LinkedIn copy-paste often
  includes nav chrome, "X people clicked apply", etc.) — don't try to be
  clever about stripping it server-side; show the user exactly what was
  saved and let them edit the text in the form before submit.
- **Manual entry missing a field** (user pastes description but skips
  location, say) — allow it; store what's given, leave the rest null, and
  let downstream matching work with partial data rather than blocking
  submission.

## Exit criteria checklist
- [ ] `JobSourceAdapter` interface implemented and documented
- [ ] 2+ working auto-ingestion adapters, each independently toggleable
- [ ] Manual entry form + `/api/jobs/manual` endpoint working, jobs created
      this way flow into the same `jobs` table and pipeline as auto-ingested ones
- [ ] Cron-callable `/api/ingest` endpoint, idempotent (safe to re-run),
      rejects requests without a valid `CRON_SECRET`
- [ ] Dedupe verified with a real duplicate-across-sources test case, and
      verified that two distinct concurrent reqs with identical
      title/company/location do NOT collapse into one row
- [ ] Per-source failure isolation verified (kill one adapter's API key, confirm others still run)
- [ ] `/specs/DECISIONS.md` updated with which sources were chosen and why
