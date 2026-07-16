# PHASE 8 — Hardening, Edge Cases, Deployment Polish

## Goal
Close out everything deferred in earlier phases, walk the full edge-case
registry (file 12) and confirm each item is actually handled (not just
listed), and get the app into a state you'd trust running unattended for
months.

## Tasks
1. Walk `12-EDGE-CASES-REGISTRY.md` top to bottom. For each item: confirm
   handled / fix / explicitly accept-and-document risk if out of scope for
   v1.
2. Add basic monitoring: a simple `/api/status` page or log stream showing
   last successful run of each pipeline stage, error counts, API quota
   usage per source. Doesn't need to be fancy — a single admin page is
   enough for a single-user app.
3. Add cost tracking: log Gemini token usage and job-source API call counts
   per day; surface a rough running-cost estimate in Settings so the user
   isn't surprised by a bill.
4. Secrets audit: confirm no API key or token appears in client-side code,
   logs, or committed files. Confirm `.env.local` is gitignored.
5. Backup/export: add a simple "export my data" (jobs, matches, drafts) as
   JSON, so the user isn't locked into the app's DB with no escape hatch.
6. Write the production deployment checklist (below) and run it once for
   real before considering the project "live."

## Production deployment checklist
- [ ] All env vars set in Vercel project settings (not just locally),
      including `CRON_SECRET`
- [ ] `CRON_SECRET` also set as a GitHub repo secret and matches the Vercel value
- [ ] Supabase Postgres connection uses the pooled connection string
      (Supavisor/pgbouncer mode) appropriate for serverless, not a direct
      long-lived connection
- [ ] Google OAuth consent screen configured for production (not just
      "testing" mode, which caps user count and can expire tokens)
- [ ] GitHub Actions scheduled workflow confirmed active (check the Actions
      tab shows scheduled runs firing, not just that the YAML parses)
- [ ] Gmail send tested from the production deployment, not just localhost
- [ ] Rate limits / API quotas for every third-party service documented in
      `/specs/DECISIONS.md` with current values (re-verify, don't assume
      old research still holds)
- [ ] Manual full pipeline run completed successfully on production URL
- [ ] `/api/status` reachable and shows green across all stages
- [ ] Cron-gated routes (`/api/ingest`, `/api/match`, `/api/draft`,
      `/api/notify`) confirmed to reject requests without a valid
      `CRON_SECRET` on the production deployment, not just locally

## Final review against CONSTITUTION.md
Before calling the project complete, explicitly re-read CONSTITUTION.md §1
and grep the entire codebase for anything that resembles LinkedIn login
automation, headless browser control of a third-party site, or an
auto-submit code path. This should be a five-minute sanity check, not a
formality — confirm it, don't assume it.
