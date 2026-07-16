# ARCHITECTURE — JobPilot

## 1. High-level flow

```
[GitHub Actions cron, e.g. every 6h]         [User pastes a LinkedIn/other
        |                                     job URL + JD text manually]
        v                                              |
[Ingestion Layer] --pulls--> [Job Board APIs / ATS endpoints]
        |                                              |
        +---------------------+-----------------------+
                              v
[Normalize + Dedupe] --> Postgres (Supabase): jobs table
        |
        v
[Matching Engine] --uses--> [Gemini API] + [profile embeddings]
        |
        v
Postgres: job_matches table (score, rationale)
        |
        v
[Drafting Engine] --uses--> [Gemini API] + [resume/portfolio corpus]
        |
        v
Postgres: application_drafts table (tailored resume, cover letter, answers)
        |
        v
[Notification] --> Gmail API digest email --> User
        |
        v
[Review UI on Vercel] --> User inspects each draft --> clicks
"Open on company site" --> user manually submits --> user marks "Applied" in app
```

Manually-entered jobs (see phase-02-ingestion.md "Manual source") skip the
scheduled ingestion step and go straight into the `jobs` table via a form
submit, then flow through the same matching/drafting/review pipeline as
every other job. This is the app's primary mechanism for covering
LinkedIn-specific postings, since automated LinkedIn ingestion is
permanently out of scope (CONSTITUTION.md §1).

## 2. Components

| Component | Responsibility | Tech |
|---|---|---|
| `ingestion/` | Poll each configured source, normalize to common Job schema, dedupe | Next.js API routes / serverless functions, run via cron |
| `matching/` | Score each new job against user profile, return 0–100 + rationale | Gemini API (structured JSON output) |
| `drafting/` | Generate tailored resume bullet edits, cover letter, screening-question answers | Gemini API |
| `web/` | Dashboard: job feed, match scores, draft review/edit, "mark applied" tracker, manual job entry form | Next.js App Router, Tailwind |
| `auth/` | Google sign-in for the single user; Gmail send scope (incremental) | NextAuth.js / Auth.js + Google provider |
| `db/` | Persistent storage + resume/file storage | Supabase (Postgres + `pgvector` + Storage) |
| `notify/` | Digest email composition + send | Gmail API |
| `scheduler/` | Trigger ingestion → matching → drafting → notify pipeline on a schedule | GitHub Actions scheduled workflow, calling API routes with `CRON_SECRET` |

## 3. Data model (initial)

```
users
  id, google_id, email, portfolio_url, created_at

profile_documents
  id, user_id, type (resume|portfolio|cover_letter_sample), raw_text,
  storage_path (Supabase Storage object path, nullable for portfolio/URL-only),
  parsed_skills (jsonb), embedding (vector), version_number, created_at

job_sources
  id, name, type (ats_api|aggregator_api|rss|manual), base_config (jsonb), enabled

jobs
  id, source_id (nullable — null for manually-entered jobs), external_id
  (nullable for manual; unique per-source when present), company, title,
  location, remote_flag, description_raw, description_url, posted_at,
  scraped_at, last_seen_at, likely_expired (bool), dedupe_hash,
  entry_method (auto|manual), raw_payload (jsonb)

job_source_links
  id, job_id, source_id, source_external_id, source_url

job_matches
  id, job_id, user_id, profile_version, score (0-100), rationale_text,
  matched_skills (jsonb), missing_skills (jsonb), flags (jsonb), status
  (new|reviewed|dismissed|drafted|match_failed), created_at

application_drafts
  id, job_match_id, profile_version, tailored_resume_text, resume_diff (jsonb),
  cover_letter_text, screening_answers (jsonb), status
  (draft|edited|applied|skipped), applied_at (nullable)

notification_log
  id, user_id, sent_at, jobs_included (jsonb), email_status

pipeline_runs
  id, stage (ingest|match|draft|notify), status (running|success|failed),
  started_at, finished_at, error_text (nullable)
```

Dedupe note: `(source_id, external_id)` is the real uniqueness key for
auto-ingested jobs — never collapse rows on that basis. The
`dedupe_hash` (normalized company+title+location) is used only to decide
whether two *different* `(source_id, external_id)` rows should be linked in
`job_source_links` as "the same real-world posting seen on multiple
boards." It must never merge/drop a row outright — two concurrently-open
reqs with identical title/company/location are common (high-volume
recruiting) and must stay distinct. Manually-entered jobs get
`entry_method = 'manual'`, `source_id = NULL`, and are still run through the
same dedupe-hash check so a manually-pasted LinkedIn job that's *also*
auto-ingested from the company's Greenhouse board gets linked, not
duplicated.

## 4. Folder structure

```
/app
  /dashboard          -> job feed + match scores
  /jobs/new            -> manual job entry form (paste URL + JD text)
  /drafts/[id]         -> review/edit a single application draft
  /settings            -> manage sources, resume upload, thresholds
  /api
    /ingest             -> cron-triggered ingestion endpoint (CRON_SECRET required)
    /match              -> cron-triggered matching endpoint (CRON_SECRET required)
    /draft              -> cron-triggered drafting endpoint (CRON_SECRET required)
    /notify             -> cron-triggered digest email endpoint (CRON_SECRET required)
    /jobs/manual        -> user-facing endpoint for manual job entry (session-auth, not CRON_SECRET)
    /auth/[...nextauth]
/lib
  /sources              -> one adapter file per job source (greenhouse.ts, lever.ts, adzuna.ts, jsearch.ts, manual.ts...)
  /gemini               -> prompt templates + client wrapper
  /db                   -> schema + queries (Supabase client)
/specs                  -> this folder, kept in repo for future-you and future-agent context
.github/workflows
  pipeline.yml          -> scheduled workflow calling /api/ingest -> /api/match -> /api/draft -> /api/notify
```

## 5. Job source adapters (Phase 2 detail, listed here for context)

Each adapter implements a common interface:
```ts
interface JobSourceAdapter {
  name: string;
  fetchListings(params: SearchParams): Promise<RawListing[]>;
  normalize(raw: RawListing): Job;
}
```
This makes adding/removing a source (e.g., dropping a dead API, adding a
new ATS) a one-file change, not a rewrite.

## 6. Why Supabase (Postgres + pgvector + Storage) + Vercel

Single-tenant, moderate data volume, need for structured querying (dedupe,
score thresholds, status tracking) — a relational DB with a native
`vector` column (pgvector, enabled by default on Supabase) is simpler than
standing up a separate vector DB for one user's job feed. Supabase Storage
also covers resume file uploads in the same service, avoiding a Google
Drive OAuth scope and a second storage provider. Revisit only if match
volume grows into the tens of thousands of postings.

## 7. Cron authentication

Every cron-triggered API route (`/api/ingest`, `/api/match`, `/api/draft`,
`/api/notify`) requires a header `Authorization: Bearer $CRON_SECRET`
matching the `CRON_SECRET` env var, checked first thing in the handler,
before any other work. The GitHub Actions workflow holds this secret as a
repo secret and passes it on each scheduled call. Without this check,
anyone who discovers the route URL could trigger paid Gemini/job-source API
calls at will — this is a required control, not an optional hardening item,
and must exist from Phase 1 (the route stubs) even though the routes'
real logic lands in later phases.
