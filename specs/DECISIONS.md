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

## Phase 4

- **Phase 3 gap fixed**: `extractProfile()` has always returned
  `experienceSummary`/`yearsExperienceByDomain`/`notableProjects`, but only
  `skills` was ever persisted — the rest were silently discarded. Matching
  needs them as prompt input, so added the missing columns to
  `profile_documents` and updated `saveResumeDocument`/`savePortfolioDocument`
  to store them. Existing resume/portfolio rows have these as null until
  re-uploaded (not backfilled).
- **Job embeddings generated lazily at match time**, not during Phase 2
  ingestion — `jobs.embedding` starts null and `ensureJobEmbedding()` fills
  it in (and persists it) the first time a job is considered for matching,
  so repeat runs don't re-embed the same job.
- **Real bug found via testing: pgvector columns come back from
  Supabase/PostgREST as their string representation** (`"[0.01,-0.02,...]"`),
  not a parsed array. `cosineSimilarity` initially did `.length` on this
  string and threw "dimension mismatch: 768 vs 9576" (9576 being the
  *character* count, not vector dimensions) — every embedding read back
  from the database now goes through `lib/matching/parseEmbedding.ts`
  first; embeddings fresh out of the Gemini SDK don't need it. Also
  retyped the raw DB row fields as `unknown` instead of `number[] | null`
  so this class of bug can't quietly recur.
- **Matching uses a different, lighter model than extraction** — real
  testing hit `RESOURCE_EXHAUSTED` (429) mid-batch-run: `gemini-flash-latest`
  (used for Phase 3 extraction) resolves to `gemini-3.5-flash`, whose free
  tier is just **5 requests/minute** (docs suggested 10-15; actual observed
  limit was tighter). Since matching runs at batch volume, switched to
  `gemini-flash-lite-latest` (`MATCHING_MODEL` in `lib/gemini/client.ts`),
  which has a more generous free-tier RPM/RPD — `EXTRACTION_MODEL` stays
  on the pricier/slower model since Phase 3 extraction is low-volume and
  quality-sensitive.
- **Cost-control knobs, tuned against real timing**: `MAX_JOBS_PER_RUN = 5`
  and `maxDuration = 60` on `/api/match` — matching calls took 8-16s each
  in testing, so the original `MAX_JOBS_PER_RUN = 10` took 80s wall-clock,
  which would be killed by Vercel's 60s Hobby-plan limit; 5 jobs
  consistently finished in ~18-20s in testing. `MAX_CALLS_PER_DAY = 150`
  for the `gemini_call_log` "matching" purpose counter — conservative
  relative to flash-lite's real ~1000 RPD, leaves headroom for other
  Gemini usage sharing the same project key. With ~950 jobs in the initial
  backlog, full first-pass coverage will take multiple days at this rate,
  by design (respecting free-tier limits over blasting through backlog).
- **`match_failed` rows are retried on subsequent runs**, not left stuck —
  the "already matched" query explicitly excludes `status = 'match_failed'`
  from what counts as already-covered, since `scoreJob`'s upsert
  (`onConflict: job_id,profile_version`) naturally overwrites a stale
  failure with a real result once a retry succeeds. Confirmed via real
  429 failure → later run picked the same job back up.
- **Verified with real data, not synthetic**: ran a full batch match
  against 954 real jobs (10 real Gemini-scored results in the first run,
  including a genuine 429 rate-limit failure handled gracefully — the
  pipeline logged it and kept scoring the other 9); confirmed idempotency
  (candidate count dropped by exactly the number successfully scored);
  confirmed the cost-cap path stops immediately with zero wasted calls
  when maxed out, and resets cleanly; confirmed the on-demand single-job
  match works end-to-end through the real UI on an actual LinkedIn-sourced
  manual job entry (Pythian SRE role — score 75, "good-fit", accurate
  matched/missing skills, correct legitimacy flag for manual entry).
- **Score threshold** stored as `users.settings.matchThreshold` (jsonb,
  default 70) — a single jsonb column rather than a dedicated settings
  table, since more per-user settings will land in later phases (Phase 7
  notification schedule) and this avoids a new table per setting.

## Phase 5

- **Drafting pipeline is 4 sequential Gemini calls** per job: tailor resume
  (`EXTRACTION_MODEL`) → fabrication check on that specific output
  (`EXTRACTION_MODEL`, adversarial framing) → cover letter
  (`MATCHING_MODEL`, with a stricter one-shot regen if it reads generic) →
  screening answers (`MATCHING_MODEL`). Tailoring and the fabrication check
  stay on the pricier/quality-sensitive model since a missed fabrication or
  a bad tailoring edit has real consequences; cover letter and screening
  answers use the higher-RPM model since they're lower-stakes free text.
- **Fabrication check is a separate adversarial call, not string-diffing**
  — deliberately skeptical prompt framing, comparing base resume against
  tailored resume specifically (not against the JD). Verified via a real
  test injecting 5 fake claims into a tailored resume (fake title, fake
  dates, fake team-leadership claim, an entirely fabricated second job,
  fake certifications) — caught all 5/5.
- **Real bug found via testing: screening-answer placeholders were
  "soft," not hard-enforced.** `ALWAYS_PLACEHOLDER_PATTERNS` regex
  (salary/compensation/work authorization/sponsorship/visa/relocation)
  was only applied when the model *failed* to set `isPlaceholder=true`.
  Real testing showed the model correctly flagged these questions as
  placeholders but still wrote soft deflection text (e.g. "Please share
  your target compensation range") instead of a hard fill-in instruction
  — exactly the "getting this wrong has real consequences" case
  CONSTITUTION.md calls out. Fixed: `forcePlaceholders()` in
  `draftScreeningAnswers.ts` now unconditionally overwrites both the
  answer text and reason for any matched category, regardless of what the
  model output. Re-verified via a temp test route: both a salary question
  and a visa-sponsorship question came back with the exact fixed
  placeholder string.
- **`MAX_DRAFTS_PER_RUN = 1`** (down from an initial guess of 2) — real
  timing measured ~33s wall-clock for one job's full 4-call pipeline; 2
  jobs risked ~66s against Vercel's 60s Hobby-plan `maxDuration`. Matches
  the same "measure real timing, tune the batch cap" pattern used in
  Phase 2 (Greenhouse) and Phase 4 (matching).
- **On-demand drafting route** (`/api/draft/[jobMatchId]`, session-authed)
  lets the user draft a below-threshold job they're still curious about,
  separate from the cron batch route which only drafts jobs already at or
  above `matchThreshold`. Fetches the specific profile version the match
  was scored against (not necessarily the latest resume), so a draft
  always reflects the profile state the match itself was based on.
  Verified end-to-end through the real dashboard UI against a real
  below-threshold job.
- **`/drafts/[id]` is deliberately plain**, not the redline/review UI —
  that's Phase 6's job. This page exists to sanity-check drafting output:
  fabrication flags (if any), resume changes as strikethrough/highlight
  pairs with a reason, full tailored resume text behind a `<details>`,
  cover letter, screening answers (placeholders visually distinct), and
  any additional-materials-requested the app can't draft.
- **Verified with real data, not synthetic**: full pipeline run against
  the real Pythian SRE job — cover letter explicitly named "Pythian"
  multiple times and cited specific JD details (Kubernetes clusters,
  observability, Prometheus/Grafana) plus concrete candidate projects
  rather than generic filler; resume diff produced sensible
  section-level changes with stated reasons; fabrication check passed
  clean on the real (non-injected) tailored output.

## Phase 6

- **Status pipeline extended with `applied`**: `job_matches.status` only
  had `new/reviewed/dismissed/drafted/match_failed` (Phase 4). Added
  `applied` plus an `applied_at` timestamp (migration 0005) for the
  "Mark as Applied" tracking action. Postgres check constraints can't be
  altered in place, so the migration drops and recreates
  `job_matches_status_check`.
- **"Reviewed" is inferred, not a button** — a match flips from `drafted`
  to `reviewed` automatically the first time its `/drafts/[id]` page is
  loaded, or when the user saves an edit to the cover letter/screening
  answers. Viewing or editing a draft is unambiguous evidence of review;
  adding a dedicated "mark reviewed" button would just be one more click
  for no real signal gain.
- **"Mark as Applied" works with or without a draft.** The spec's dashboard
  quick actions list it alongside "view draft"/"dismiss" as a per-row
  action, and a user may reasonably apply to a job directly from the
  company's site without ever drafting anything through this app first
  (e.g. a below-threshold job they only glanced at). The apply route only
  requires match ownership, not an existing `application_drafts` row; if
  one exists, its status/`applied_at` are updated too for consistency.
- **Soft-warning placeholder check is done by exact string match**, not a
  stored boolean — `PLACEHOLDER_TEXT` was pulled out of
  `draftScreeningAnswers.ts` (which has `import "server-only"`) into a
  new `lib/drafting/placeholderText.ts` with no such import, so the
  client-side `EditableScreeningAnswers`/`MarkAppliedButton` components
  can compare the *current* (possibly user-edited) answer text against it
  directly. This means editing a placeholder answer away from the exact
  fixed string clears its "unfilled" warning immediately, without needing
  a separate `filled` flag to track and keep in sync.
- **Bulk-dismiss and dismiss both refuse to touch an `applied` match** —
  dismissing something you've already applied to would be a confusing,
  effectively-irreversible-feeling state change for a single-tenant
  tracking tool; not allowed rather than silently overwritten.
- **Dashboard's "Below threshold" section defaults to open, not
  collapsed.** Built collapsed-by-default first per the spec's literal
  "visible-but-collapsed" wording, but real testing showed this reads as
  data loss: matching a job on-demand via "Match this job now" often
  scores it below threshold, and having it immediately vanish into a
  closed `<details>` looked exactly like the row had disappeared. Fixed
  by defaulting the section open — still visually separated from the
  active/above-threshold list (which was the actual point), but nothing
  requires an extra click to discover right after the action that
  produced it.
- **Dashboard status filter (`active`/`applied`/`dismissed`/`all`) uses two
  different query shapes**, not one query with a status `WHERE` clause
  tacked on: the default `active`/`all` views are still "top 25 jobs by
  `last_seen_at`, left-joined to this profile version's matches" (unscored
  jobs need to stay visible so they can still be matched on-demand); the
  `applied`/`dismissed` views instead query `job_matches` directly, since
  by definition every row there already has a match and unscored jobs are
  irrelevant to those filters.
- **Real bug found via testing, diagnosed and ruled out as non-code**:
  after clicking "Match this job now," the job briefly appeared to vanish
  from the dashboard entirely (not just the below-threshold-collapse
  issue above — this was before that fix even applied, and persisted one
  test cycle after it). Confirmed via direct DB query that the
  `job_matches` row was written correctly and within the fetched top-25
  window both times; a hard reload (F5) then showed it correctly. Concluded
  this was a client-side `router.refresh()` timing/cache artifact, not a
  data or filtering bug — consistent with `MatchButton`/`DraftButton`
  already relying on the same `router.refresh()` pattern in earlier
  phases without issue. No code change made for this; noted here in case
  it recurs and turns out not to be a one-off.
- **No expired-posting banner exercised with real data** — no job in the
  current dataset has `likely_expired = true` yet, so `/drafts/[id]`'s
  "this posting may no longer be live" banner (conditioned on that same
  column, already relied on elsewhere since Phase 2) is verified by code
  review only, not a real end-to-end trigger. Low risk since it reuses an
  existing, already-tested column and a simple conditional render.
- **Verified with real data, not synthetic**: full manual walkthrough —
  dashboard sort/filter/grouping, bulk-dismiss (moved jobs into the
  Dismissed filter), single dismiss, on-demand match-then-appear flow,
  editable cover letter save, editable screening-answer save (placeholder
  highlight cleared on edit), and Mark as Applied (confirm-dialog warning
  fired, status flipped to Applied ✓ and reflected on both the draft page
  and the dashboard's Applied filter).
- **Grepped the full `src/` tree for outbound submission paths** (Phase 6
  exit criteria) — confirmed the only network calls anywhere are to this
  app's own `/api/*` routes; the sole reference to an external job-posting
  URL is a plain `<a href={job.description_url} target="_blank">` the
  user clicks themselves. No automation library (Puppeteer/Playwright/
  Selenium) is a direct dependency.

## Phase 7

- **Gmail send via the raw Gmail API (`users.messages.send`), not
  nodemailer/SMTP** — reuses the same Google OAuth client already
  configured for sign-in instead of managing separate SMTP credentials.
  The refresh token needed to send with no live user session comes from
  an incremental-consent re-auth (`access_type=offline&prompt=consent`),
  requested only when the user clicks "Connect Gmail" in Settings — the
  default sign-in flow still only asks for `openid email profile`.
- **The four pipeline routes (`/api/ingest`, `/api/match`, `/api/draft`,
  `/api/notify`) now accept either a `CRON_SECRET` bearer token or a valid
  session** (`lib/cron/verifyCronOrSession.ts`, replacing the old
  cron-only `verifyCronSecret.ts`, which is now dead code and deleted) —
  needed so Settings' "Run now" button can call the exact same routes the
  GitHub Actions workflow calls, per phase-07 task 4.
- **DB-based pipeline lock, not a distributed lock service**: a single
  `pipeline_runs` row per run, acquired by `/api/ingest` (the first step)
  and released by `/api/notify` (the last step) — `lib/cron/pipelineLock.ts`.
  A stale-lock timeout (15 min) prevents a crashed mid-sequence run (e.g.
  match or draft fails and the GitHub Actions job stops before reaching
  notify) from permanently blocking future runs; the next `/api/ingest`
  call detects the stale row, marks it `failed`, and proceeds. Verified
  for real: firing two concurrent `/api/ingest` calls got a 200 on the
  first and a 409 ("A pipeline run is already in progress.") on the
  second.
- **`notifications_enabled`/`timezone` live in `users.settings` jsonb**
  (same pattern as `matchThreshold`, Phase 4) since they're user-tunable
  preferences; `google_refresh_token`/`notifications_paused(_reason)`/
  `last_notified_at` are dedicated columns (migration 0006) since they're
  server-written pipeline/auth state, not something a user edits via a
  form — mirrors the existing split between `users.settings` and
  dedicated columns already established for the rest of the table.
- **Timezone only affects display, not the query window** — "since last
  digest" is computed by comparing `job_matches.created_at` (an absolute
  timestamp) against `users.last_notified_at`, which is correct regardless
  of the user's timezone. The stored `timezone` setting exists for future
  display use (e.g. showing times in the digest in local time) rather than
  changing what counts as "new."
- **`last_notified_at` only advances on `sent` or `skipped_no_matches`,
  never on `failed`** — a Gmail auth/send failure must not cause the
  matches from that window to silently disappear from the next digest.
  Verified for real: corrupted the stored refresh token, ran `/api/notify`
  with `last_notified_at` reset to null so there was something to send,
  confirmed the failure path set `notifications_paused = true` with the
  reason `"Gmail access expired — please reconnect."`, and confirmed
  `last_notified_at` stayed null (not advanced) throughout.
- **Real bug found via testing — actually a sequencing issue, not a code
  bug**: the first "Connect Gmail" attempt didn't return a refresh token.
  Diagnosed by temporarily logging `hasRefreshToken`/`scope` into an
  unused DB column (no access to the dev server's stdout from the
  debugging session) rather than guessing — confirmed the OAuth
  round-trip and `authorizationParams` plumbing were correct all along;
  the real cause was that the Google Cloud OAuth consent screen was still
  in "Testing" publishing status and the user's own account hadn't been
  added as a test user yet, so Google silently declined the sensitive
  `gmail.send` scope grant. Once added as a test user, the retry
  correctly returned `hasRefreshToken=true` with `gmail.send` in the
  granted scope. Debug code was removed after confirming.
- **Known limitation, accepted**: refresh tokens issued while a Google
  Cloud OAuth app is in "Testing" publishing status can expire after
  about 7 days regardless of use. For this single-user hobby-scale app,
  documented in README as "click Reconnect Gmail if notifications stop"
  rather than pursuing full app verification/production publishing,
  which buys nothing here beyond removing an occasional one-click
  reconnect.
- **Verified with real data, not synthetic**: full manual walkthrough —
  Connect Gmail (real incremental consent, real refresh token captured),
  enabling notifications + timezone (confirmed persisted), "Run now"
  (all four steps completed, a real digest email arrived with a working
  "Review this match →" link into the correct draft page), concurrent
  pipeline lock (409 on overlap, confirmed via direct curl test), and the
  auth-failure banner (confirmed showing on both dashboard and settings,
  then cleared automatically on reconnect).
