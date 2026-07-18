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

## Phase 3

- **Libraries verified against current docs, not assumed**: `@google/genai`
  (2.12.0) is the current official Gemini SDK — `ai.models.generateContent`
  / `ai.models.embedContent` confirmed against the shipped `.d.ts` (a
  newer `ai.interactions` agentic API also exists in the SDK but is
  unnecessary complexity for one-shot extraction/embedding calls). `unpdf`
  chosen over `pdf-parse` for PDF text extraction — zero native
  dependencies, built for serverless/Vercel (pdf-parse depends on
  `pdfjs-dist`'s optional `canvas` native module, a known Vercel build
  failure). `mammoth` for DOCX (standard, pure JS).
- **Models**: extraction uses `gemini-flash-latest` (low volume — only
  runs on upload — so flash-tier quality is fine and keeps cost
  predictable). Embedding uses `gemini-embedding-2` at 768 dimensions
  (matches the `vector(768)` column from the Phase 1 migration; the
  migration's original comment referenced `text-embedding-004`, which is
  no longer current — the model name doesn't affect the schema since
  dimension is set explicitly via `outputDimensionality`).
- **Resume is the canonical/effective profile** (spec was ambiguous
  between per-document vs. one combined embedding — see the assumption
  flagged to the user before building): the resume row's `parsed_skills`
  is what Settings displays/edits and what Phase 4 will read. Portfolio
  gets its own row + embedding (for history), but its skills are always
  merged (union, never overwrite) into the current resume row. User edits
  via the Skills editor always land on the resume row and win over
  whatever extraction/merge produced.
- **Three real bugs found via end-to-end testing with the user's actual
  resume and portfolio** (not caught by synthetic tests — worth calling
  out since this is exactly why real-data verification matters):
  1. **Silent failure in the UI**: `saveResumeDocument`/`savePortfolioDocument`
     can insert a row successfully while extraction or embedding failed
     (network/rate-limit issues) — the original `ResumeUploadForm`/
     `PortfolioForm` only checked HTTP status and reported "saved" either
     way, hiding a real failure (a resume saved with zero skills, no
     visible error). Fixed: both forms now surface `extractionError`/
     `embeddingError` from the response as a visible warning.
  2. **No backoff on Gemini retries**: `extractProfile` retried once on
     failure with zero delay — useless against a rate limit, since an
     immediate retry hits the same limit again. `embedText` had no retry
     at all, despite CONSTITUTION.md §4 requiring retry-with-backoff for
     every external API call. Fixed: both now go through
     `lib/gemini/retryWithBackoff.ts` (3 attempts, exponential delay,
     matching the pattern already used for HTTP calls in
     `lib/http/fetchWithRetry.ts`), and failures are logged server-side
     so future issues are diagnosable from logs instead of reconstructed
     forensically from DB state.
  3. **ArrayBuffer detachment corrupting storage uploads**: the resume
     route read the uploaded file into one `ArrayBuffer`, ran it through
     `unpdf`'s PDF extraction, then uploaded that same buffer to Supabase
     Storage — but PDF.js can transfer/detach the underlying buffer while
     parsing, and two real uploads confirmed this landed as 0-byte files
     in storage despite text extraction succeeding fine (extraction reads
     the data before/during detachment, an independent copy operation
     wasn't). Fixed: upload the pristine buffer to storage *before*
     running it through extraction, not after.
  4. **Stale client state in `SkillsEditor`** (not a data-layer bug, but
     caused an apparent one): the component seeds `useState` from an
     `initialSkills` prop with no `key`, so React preserves its internal
     state across a `router.refresh()` after a new resume upload — a
     "Save skills" click at that point PATCHes with the stale (possibly
     empty, from before any resume existed) list, overwriting the
     freshly-merged skills that had just saved correctly. This is what
     actually produced a couple of the "empty skills" rows initially
     misdiagnosed as extraction failures. Fixed: `SkillsEditor` now gets
     `key={resume.id}` so it remounts (resetting state) whenever the
     underlying resume document changes.
  Takeaway logged for future phases: when a "bug" reproduces, verify each
  layer independently (raw text → LLM call → save function → route →
  UI) before assuming the most recently-touched code is at fault — three
  of these four issues were in different layers than initially suspected.
- **Known limitation, not fixed**: if resume and portfolio are saved
  within seconds of each other (as happened during rapid manual testing),
  the two saves' merge-back steps can race — whichever save's
  `getLatestProfileDocument` read happens first won't see the other's
  not-yet-committed row. Not fixed since normal usage (upload resume,
  separately upload portfolio, each a deliberate action with time
  between) won't hit this; revisit only if it causes a real problem.
- **Sign-in restricted to the owner's email** (`ALLOWED_USER_EMAIL` env
  var, checked in `src/auth.ts`'s `signIn` callback) — found during
  testing that a second Google account had signed in and gotten its own
  siloed profile, which isn't what "single-tenant" (CONSTITUTION.md §3)
  is meant to guarantee for a deployed app with a public URL. Optional
  (unset = no restriction) so this doesn't become a required-at-boot var
  for anyone who forks this later.
