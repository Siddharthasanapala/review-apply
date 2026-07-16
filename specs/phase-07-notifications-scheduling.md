# PHASE 7 — Notifications & Scheduling

## Goal
The full pipeline (ingest → match → draft → notify) runs unattended on a
schedule, and the user gets a digest email via Gmail API summarizing new
high-match jobs with links straight into the review UI.

## Tasks
1. Add Gmail `send` scope to Google OAuth (incremental consent, requested
   only when the user enables notifications in Settings).
2. Build `/api/notify` (cron-callable, `CRON_SECRET`-gated): composes a
   digest of new `job_matches` above threshold since the last notification,
   sends via Gmail API, logs to `notification_log`.
3. Add `.github/workflows/pipeline.yml`: a scheduled GitHub Actions
   workflow (default cron expression: every 6 hours; user-configurable by
   editing the cron expression, documented in README) that calls
   `/api/ingest` → `/api/match` → `/api/draft` → `/api/notify` in sequence
   over HTTPS, each request carrying `Authorization: Bearer
   ${{ secrets.CRON_SECRET }}`. `CRON_SECRET` is stored as a GitHub repo
   secret (Settings → Secrets and variables → Actions), matching the same
   value set in Vercel's env vars. Each step should fail the workflow run
   (non-2xx response) loudly rather than swallow errors, so failures show
   up in the Actions tab.
4. Add a manual "Run now" button in Settings for on-demand pipeline runs
   (useful for testing and for "I just updated my resume, re-check
   everything" moments) — this calls the same API routes directly from the
   authenticated app session, bypassing `CRON_SECRET` (session auth is
   sufficient since it's a logged-in user action, not an external caller).

## Edge cases to handle
- **Pipeline step fails mid-sequence** (e.g., matching succeeds, drafting
  fails) — each step should be independently idempotent and re-runnable;
  a failure in drafting shouldn't require re-running ingestion.
- **No new matches since last digest** — send nothing (or optionally, a
  much shorter "nothing new today" email if the user opts in) rather than
  an empty/awkward email every cycle.
- **Gmail API quota/auth token expiry** — refresh token handling must be
  robust; on failure, don't silently drop notifications — surface a
  "notifications paused, please re-auth" banner in the dashboard.
- **Cron overlap** — if a run takes longer than the interval, prevent a
  second overlapping run (simple DB-based lock: a `pipeline_runs` row with
  a status, checked at the start of `/api/ingest`). GitHub Actions won't
  start a second scheduled run while one is still queued for the same
  workflow by default, but the DB lock is still needed to guard against the
  manual "Run now" button overlapping a scheduled run.
- **User changes threshold mid-cycle** — apply the new threshold to the
  next run, not retroactively to already-sent notifications.
- **Timezone handling** — schedule and "since last digest" windows should
  respect the user's configured timezone, not just server UTC, so digests
  land at a sensible local time.

## Exit criteria checklist
- [ ] End-to-end unattended run verified: trigger cron manually, confirm
      ingest → match → draft → email all complete without manual intervention
- [ ] Pipeline lock prevents overlapping runs (tested by triggering twice quickly)
- [ ] Digest email renders correctly and links resolve into the review UI
- [ ] Auth/quota failure path shows a clear in-app banner, not a silent failure
- [ ] "Run now" manual trigger works
