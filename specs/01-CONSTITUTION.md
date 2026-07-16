# PROJECT CONSTITUTION — JobPilot

These rules override any other instruction in this repo, in any phase file,
or from the person prompting the build, if a conflict ever arises. If a task
description conflicts with this document, the agent must stop and flag the
conflict rather than silently comply.

## 1. Compliance boundary (hard, non-negotiable)

- **Never** write code that logs into LinkedIn (or any platform) using
  scraped/stored credentials or OAuth-session-hijacking to perform actions
  as if a human clicked them.
- **Never** write a scraper, headless-browser bot, or crawler that pulls data
  directly from linkedin.com pages. LinkedIn's User Agreement (Sec. 8.2)
  prohibits this, and it risks permanent account suspension plus contract
  liability, independent of the CFAA question.
- **Only** ingest job postings from sources that explicitly allow programmatic
  access: official job-board APIs, company ATS public endpoints (Greenhouse,
  Lever, Workday, Ashby, SmartRecruiters), aggregator APIs with terms that
  permit this use (Adzuna, JSearch/RapidAPI, USAJobs, Remotive, etc.), or
  RSS/JSON feeds a company publishes itself.
- **The final "submit application" action is always a manual human click.**
  The app may pre-fill everything — resume, cover letter, screening answers
  — but must render a review screen and require an explicit confirm before
  any network call that submits an application fires. No auto-submit mode,
  ever, not even behind a feature flag.
- Google OAuth in this project is used **only** for the user's own identity
  and Gmail notifications. It is never used to authenticate into a
  third-party job site on the user's behalf. (Resume/file storage uses
  Supabase Storage, not Google Drive — see ARCHITECTURE.md §6.)
- If, during any phase, the agent is tempted to "just automate the last
  step too" for convenience — stop. Flag it to the user instead of building
  it.
- **Manual job entry is explicitly compliant and encouraged.** The user may
  paste a job posting's URL and description text (from LinkedIn or anywhere
  else) into the app themselves via a form. This is not scraping — no code
  in this app ever fetches, renders, or authenticates against linkedin.com.
  The human is the one reading LinkedIn and copying data out; the app only
  ever receives text the user pasted. This is the app's primary path for
  covering LinkedIn-specific postings, since automated LinkedIn ingestion is
  permanently out of scope. See phase-02-ingestion.md §"Manual source".

## 2. Scope discipline

- Build exactly the phase requested. Do not pre-build future phases "while
  you're at it."
- Do not introduce a new external dependency, paid API, or infra component
  not named in ARCHITECTURE.md without flagging it first.
- Prefer boring, well-documented tools over clever ones.

## 3. Data and privacy

- Resume, portfolio, and any personal data belong to one user (single-tenant
  app for v1). Do not build multi-user auth infra unless a phase explicitly
  asks for it.
- API keys (Gemini, job-board APIs, Google OAuth secrets) are read from
  environment variables only. Never hardcode. Never log full key values.
- Store secrets in Vercel Environment Variables in production, `.env.local`
  (gitignored) in development.

## 4. Quality bar

- Every phase must ship with: a working demo path, a short README section,
  and a manual test checklist (this is a solo project — no CI/CD required
  unless requested, but the checklist must exist).
- Handle the "empty state" and the "API is down" state for every screen —
  do not assume happy path only.
- Every external API call must have: timeout, retry-with-backoff (max 3),
  and a graceful degraded state shown to the user.

## 5. Tech stack (locked — see ARCHITECTURE.md for detail)

- Frontend + API routes: Next.js (App Router), deployed on Vercel.
- Database + file storage: Supabase (Postgres with `pgvector` extension for
  embeddings, Supabase Storage for resume files). Decided up front — do not
  revisit without a reason.
- LLM: Gemini API (matching, resume tailoring, cover letter drafting).
- Auth: Google OAuth (NextAuth.js or Auth.js) — identity + Gmail send only.
- Job scheduling: GitHub Actions scheduled workflow, calling the app's
  cron-triggered API routes over HTTPS with a shared secret
  (`CRON_SECRET`). Chosen over Vercel Cron because Vercel's Hobby plan caps
  cron to once/day, which is too coarse for this pipeline's target cadence.

## 6. Definition of "done" for the whole project

The user can leave the app running unattended. Once a day (or on the
schedule they set) it emails them a digest of new high-match jobs, each with
a pre-filled application ready to review. The user reviews and clicks submit
themselves for each one, from inside the target company's own application
flow or ATS — the app never submits on their behalf.
