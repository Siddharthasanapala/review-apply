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
