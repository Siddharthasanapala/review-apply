# JobPilot

An AI-assisted job-matching and application-drafting tool. It matches job
postings against your resume, drafts a tailored application, and hands it
to you for review — you always click submit yourself. See `specs/` for the
full build plan and non-negotiable rules (`specs/01-CONSTITUTION.md`).

## Phase 1 — Foundation

Sets up: Next.js app, Supabase (Postgres + pgvector + Storage), Google
sign-in, and `CRON_SECRET`-gated stub routes for the pipeline endpoints
that later phases fill in.

### Setup

1. Copy `.env.example` to `.env.local` and fill in every value (see the
   comment above each var for where to get it).
2. Create a Supabase project. In the SQL Editor, run
   `supabase/migrations/0001_init.sql`.
3. In Google Cloud Console, create an OAuth client (Web application),
   with `http://localhost:3000/api/auth/callback/google` as an authorized
   redirect URI for local dev (add the production URL's equivalent once
   deployed).
4. `npm install`
5. `npm run dev`, then open [http://localhost:3000](http://localhost:3000).

### Manual test checklist (Phase 1)

- [ ] `npm run dev` starts without errors given a complete `.env.local`
- [ ] Starting the app with a `.env.local` missing a required var fails
      immediately with a clear error (not a silent misbehavior)
- [ ] Clicking "Sign in with Google" completes the OAuth round-trip and
      lands on `/dashboard`
- [ ] Denying the Google consent screen lands on a clear retry page, not a crash
- [ ] Visiting `/dashboard` while signed out redirects to `/`
- [ ] `/api/health` returns `200` with `{ app: "ok", db: "ok" }` when Supabase is reachable
- [ ] `/api/ingest`, `/api/match`, `/api/draft`, `/api/notify` all return
      `401` when called without a `CRON_SECRET` bearer token, and `501`
      when called with the correct one (expected until their real phases land)
- [ ] Signing in creates a row in Supabase's `users` table

## Phase 7 — Notifications & Scheduling

Runs the full pipeline (ingest → match → draft → notify) unattended on a
schedule via GitHub Actions, and emails a digest of new high-match jobs
through the Gmail API.

### Setup

1. Run `supabase/migrations/0006_notifications.sql` in the Supabase SQL
   Editor.
2. In Google Cloud Console, on the same OAuth client used for sign-in:
   enable the **Gmail API** (APIs & Services → Library), and if the OAuth
   consent screen is in "Testing" mode, make sure your account is added as
   a test user (needed to grant the `gmail.send` scope without publishing
   the app).
3. In Settings, click **Connect Gmail** — this is a separate, incremental
   consent step from regular sign-in, and is what lets the app send
   digest emails on your behalf later without you being logged in (it
   requests offline access and returns a refresh token, stored server-side).
4. Enable **"Email me a digest of new high-match jobs"** in Settings, and
   set your timezone (used for display in the email; the underlying
   "since last digest" query is timestamp-based and correct regardless of
   timezone).
5. In the GitHub repo (Settings → Secrets and variables → Actions), add a
   repository secret `CRON_SECRET` with the same value as the app's
   `CRON_SECRET` env var. The workflow's `APP_URL` is not secret — it's a
   plain `env:` value at the top of `.github/workflows/pipeline.yml`, edit
   it there if the production URL ever changes.
6. Push to `main` (or trigger it manually from the Actions tab —
   `workflow_dispatch` is enabled) to run the pipeline. Default schedule
   is every 6 hours; edit the cron expression in
   `.github/workflows/pipeline.yml` to change it.
7. Use the **"Run now"** button in Settings any time for an on-demand run
   (e.g. right after updating your resume) — same routes, session-authed
   instead of `CRON_SECRET`.

### Manual test checklist (Phase 7)

- [ ] Clicking "Connect Gmail" completes an incremental consent screen
      (showing the Gmail send permission) and returns to Settings
- [ ] Enabling notifications and clicking "Run now" completes all four
      steps and, if there are new above-threshold matches, a digest email
      arrives with working links into the review UI
- [ ] Manually triggering "Run now" twice in quick succession — the second
      attempt is rejected with a "pipeline already running" message, not a
      duplicate ingest/match/draft/notify cycle
- [ ] Revoking Gmail access (Google Account → Security → Third-party
      access) and running the pipeline again shows a "notifications
      paused, please reconnect" banner on the dashboard, not a silent
      failure
- [ ] The GitHub Actions workflow run (Actions tab → JobPilot Pipeline →
      "Run workflow") completes all four steps successfully

## Learn more about the Next.js template

This project was bootstrapped with `create-next-app`. See
[Next.js Documentation](https://nextjs.org/docs) for framework details.
