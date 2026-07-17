# DECISIONS LOG

Nontrivial choices made during the build, in order. Later phases append —
don't re-litigate an entry here without a concrete new reason.

## Pre-Phase 1 (spec review)

- **Manual job entry added as a core ingestion path** (not just automated
  sources). Reason: the compliant-source pipeline (Greenhouse, Lever,
  Adzuna, JSearch, etc.) cannot cover most LinkedIn-specific postings since
  automated LinkedIn access is permanently out of scope
  (CONSTITUTION.md §1). A user-driven paste-in form is fully compliant
  (the human reads LinkedIn, the app never does) and is the main way
  LinkedIn jobs enter the app. See phase-02-ingestion.md.
- **Database + storage: Supabase**, not Vercel Postgres + Vercel Blob.
  Reason: native `pgvector` support for embeddings and built-in file
  storage for resumes in one service, avoiding a Google Drive OAuth scope
  entirely.
- **Scheduling: GitHub Actions cron**, not Vercel Cron. Reason: Vercel's
  Hobby plan caps cron to once/day, too coarse for the pipeline's target
  ~6-hour cadence; Vercel Pro ($20/mo) would be needed otherwise. GitHub
  Actions is free and calls the app's API routes over HTTPS with a shared
  `CRON_SECRET`.
- **Dedupe key fixed to `(source_id, external_id)`**, not the fuzzy
  company+title+location hash. Reason: the hash alone would incorrectly
  collapse genuinely distinct concurrent job reqs (common with high-volume
  recruiters). The hash is now used only to *link* likely-duplicate
  postings across sources via `job_source_links`, never to merge/drop rows.
- **Fabrication check (Phase 5) specified as a second, adversarial Gemini
  call**, not string-diffing. Reason: a rephrased fabrication won't show up
  as a text diff against the base resume; an independent critic prompt is
  the reliable mechanism.

## Phase 1

- **Next.js 16** was installed by `create-next-app` (latest at build time).
  Notable breaking change from prior Next versions: `middleware.ts` is
  deprecated and renamed to `proxy.ts`. This app does not use either —
  auth checks are done directly in each server component/route handler via
  `auth()` (Next's own current recommendation: "verify authentication
  inside each Server Function rather than relying on Proxy alone").
- **Auth.js (`next-auth@5` beta)** used for Google OAuth, with **JWT
  session strategy** (no DB session adapter) — simplest option for a
  single-tenant app. On successful Google sign-in, the `signIn` callback
  upserts a row into `users` keyed on `google_id`.
- **Supabase client usage**: server-side code uses the **service-role key**
  directly (`src/lib/supabase/server.ts`), not Postgres Row Level Security.
  Reason: single-tenant app, all server code paths are already gated by
  session auth or `CRON_SECRET` — RLS would add complexity with no benefit
  here. Revisit only if the app ever becomes multi-tenant.
- **Embedding column dimension**: `profile_documents.embedding` is
  `vector(768)`, assuming Gemini's `text-embedding-004`. Confirm/adjust in
  Phase 3 when the embedding model is actually picked.
- **DB migrations**: plain numbered `.sql` files in `supabase/migrations/`,
  applied manually via the Supabase SQL Editor (no Supabase CLI project
  link set up yet). Revisit if migration friction becomes a real problem.
- **Env var validation**: `src/lib/env.ts` parses `process.env` with Zod at
  import time and throws immediately if anything required is missing —
  this is what makes a missing Vercel env var fail the build/boot loudly
  instead of misbehaving at runtime (CONSTITUTION.md §4).
- **Deployment**: Vercel project `jobpilot` (team
  `siddharthasanapala136-gmailcoms-projects`), linked to GitHub repo
  `Siddharthasanapala/review-apply`. Production URL:
  `https://jobpilot-five-gamma.vercel.app`. Verified end-to-end: health
  check, cron-secret gating on all four stub routes, and Google sign-in
  round-trip all confirmed working on the live URL.
- **Lesson learned — don't use bash `source` on `.env` files**: pushing env
  vars to Vercel via a shell script that did `source .env.local` silently
  truncated `CRON_SECRET` at its `;` character (bash treats `;` as a
  command separator; dotenv parsers, including Next.js's own, do not). The
  wrong value landed in Vercel's production env vars until caught and
  fixed by generating a new alphanumeric-only secret. Takeaway for future
  phases: never `source` a `.env*` file in bash to extract values for
  another tool — read it with a proper dotenv parser (or plain string
  parsing) instead, and prefer secret values without shell-special
  characters (`;`, `$`, backticks, quotes) to reduce blast radius even if
  parsed correctly elsewhere.

## Phase 2

- **Sources chosen**: Greenhouse (37 verified company boards — see
  `job_sources.greenhouse.base_config.companies` for the live list; slugs
  were checked one-by-one against the real API before use, since the
  user-provided list included several invalid/guessed slugs) and Adzuna
  (countries `us` + `in`, 6 role-keyword queries, free-tier "personal
  research" use). Both real APIs' terms were fetched and read at
  integration time, not assumed — see the Phase 2 session notes.
- **Title-keyword filtering added to Greenhouse** (not in the original
  spec): real company boards return every open role across every
  department (e.g. Databricks: 794 total, Stripe: 526), not just
  engineering. `base_config.titleKeywords` filters to role-relevant titles
  before any description is fetched. Without this, ingestion volume and
  cost in later phases (Gemini matching/drafting per job) would be
  dominated by irrelevant postings (sales, legal, support, etc.).
- **Ingestion batched, not per-row** — the original per-listing design (2-4
  sequential Supabase round trips per listing) was tested against real
  data and confirmed too slow: with ~950 real matched listings across 37
  companies it would take minutes, well past a serverless function's time
  limit. Rewrote as `upsertIngestedJobsBatch` (`lib/jobs/ingestJob.ts`): a
  constant number of chunked bulk queries (`.in()` lookups + a single
  `.upsert()` with `onConflict`) regardless of listing count, chunked at
  200 rows to keep any one request reasonably sized.
- **Greenhouse fetch is two-step and concurrency-bounded** — verified the
  list endpoint without `content=true` is ~10x smaller (313KB vs 3.9MB for
  one real company) and sufficient to title-filter; full descriptions are
  only fetched for listings that pass the filter (~5-7% of total,
  verified against Stripe's real board). Those detail fetches, and the
  37 companies' list fetches, run with bounded concurrency
  (`lib/http/mapWithConcurrency.ts`, 10-15 in flight) rather than
  sequentially — sequential detail fetches alone (before this fix) timed
  out past 2 minutes; concurrent, the full 37-company run completes in
  ~30s. `/api/ingest` also sets `export const maxDuration = 60` (Vercel
  Hobby's max) for headroom.
- **Adzuna makes one HTTP call per (country, query) combination** — its
  `what` param doesn't support multiple independent phrases per call. With
  2 countries × 6 queries = 12 calls/run, at the user's ~6h cadence that's
  ~48 calls/day, safely under the 250/day free-tier cap (configured
  `rateLimit.maxCallsPerDay: 200` as a safety ceiling below the real
  limit). The quota check (`lib/jobs/quota.ts`) is called per actual
  outbound call via a callback passed into the adapter, not once per
  source, so a run stops making new calls exactly when the daily cap is
  hit rather than skipping the whole source preemptively.
- **Listings deduped by `externalId` within a single ingest run**
  (`/api/ingest/route.ts`'s `dedupeByExternalId`) — Adzuna's multiple
  queries can return the same job more than once in one run (e.g. a
  posting matching both "software engineer" and "backend developer").
  Without this, a bulk `.upsert()` with duplicate conflict keys in the
  same call errors in Postgres ("ON CONFLICT DO UPDATE command cannot
  affect row a second time").
- **Verified with real data, not just synthetic tests**: ran ingestion
  against the live Greenhouse API end-to-end — 952 real jobs ingested in
  ~31s; re-ran to confirm idempotency (0 inserted, 952 updated on the
  second run); temporarily injected an invalid company slug to confirm
  per-company failure isolation (952 jobs from the other 37 companies
  still ingested correctly, bogus company logged and skipped). Adzuna
  itself is not yet live (keys pending user's account verification) — it
  correctly reports "adapter unavailable" and doesn't block Greenhouse,
  which is itself a real (not synthetic) whole-source failure-isolation
  test.
- **Deferred: fake/scam posting legitimacy check** (user-raised
  requirement, 2026-07-17) — not built this phase. See
  12-EDGE-CASES-REGISTRY.md "Fake/scam postings" and the corresponding
  notes added to phase-04-matching-engine.md and
  phase-06-review-submit-ui.md. Recommended landing spot: a `flags` entry
  in Phase 4 for aggregator/manual-sourced jobs (official ATS sources are
  inherently trustworthy — they're the company's own posting system), and
  a clear trust-level indicator in the Phase 6 review UI. A deeper
  check (cross-referencing company reviews on other sites) needs new
  external API research before building, per CONSTITUTION.md's diligence
  requirement — no obvious compliant Glassdoor/Indeed-reviews API is known
  yet.
- **Adzuna keys pending**: user has registered but email verification was
  still processing as of this session. `adzuna` source is enabled with
  real config already seeded; it will start working the moment
  `ADZUNA_APP_ID`/`ADZUNA_APP_KEY` are set in `.env.local` and Vercel, no
  code changes needed.
