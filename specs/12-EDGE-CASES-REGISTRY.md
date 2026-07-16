# EDGE CASES REGISTRY (living document)

Consolidated from every phase file, for quick reference during Phase 8
hardening and for updating as new edge cases surface post-launch. Add new
rows as you discover issues in real use — don't let this go stale.

## Compliance / legal
- [ ] No LinkedIn (or other ToS-restricted platform) scraping/automation anywhere
- [ ] No auto-submit code path anywhere in the repo
- [ ] Third-party API terms re-verified at integration time, not assumed from memory
- [ ] Secrets never logged, never in client bundle, never committed
- [ ] Manual job entry never triggers a server-side fetch of the pasted URL
      against a ToS-restricted domain — it stores only what the user typed/pasted

## Data ingestion
- [ ] Duplicate postings across multiple sources LINKED (job_source_links),
      not collapsed into a single row when they're actually distinct concurrent reqs
- [ ] `(source_id, external_id)` used as the real uniqueness key, not the
      fuzzy dedupe hash
- [ ] Stale/expired postings flagged, not deleted
- [ ] Malformed source payloads sanitized, raw payload preserved
- [ ] One source's downtime doesn't block others
- [ ] API quota exhaustion degrades gracefully
- [ ] Fuzzy-duplicate detection for reposted/slightly-edited listings
- [ ] Location/remote-status normalization consistent across sources
- [ ] Manually-entered job checked against dedupe hash so it links to an
      existing auto-ingested duplicate instead of creating a redundant row
- [ ] Cron-triggered ingestion routes reject requests without a valid `CRON_SECRET`

## Profile ingestion
- [ ] Low-confidence PDF text extraction detected, fallback offered
- [ ] JS-rendered portfolio sites handled or gracefully degraded
- [ ] Resume/portfolio conflicting info merged, not silently dropped
- [ ] Profile versioning preserved on re-upload
- [ ] Oversized documents chunked, not truncated silently

## Matching
- [ ] Embedding pre-filter reduces cost without excluding real matches
- [ ] Malformed Gemini JSON output triggers retry-once, then explicit failure state
- [ ] Score threshold changes don't retroactively corrupt history
- [ ] Unverifiable requirements (clearance, authorization) flagged, not guessed
- [ ] Daily Gemini call cap prevents runaway cost
- [ ] False-positive keyword-only matches caught by rationale requirement

## Drafting
- [ ] Fabrication check (separate critic Gemini call, not string-diffing)
      catches invented facts not present in base resume
- [ ] Salary/sponsorship questions always placeholder, never auto-filled
- [ ] Generic cover letters regenerated with stricter prompt
- [ ] Draft records exact profile version + job_match used

## Review UI
- [ ] Zero network paths submit an application without explicit user click
- [ ] Placeholder fields visually unmissable
- [ ] Dead/expired postings warned before user clicks through
- [ ] Bulk actions available for queue management at scale
- [ ] Mobile-usable review screen

## Notifications & scheduling
- [ ] Pipeline steps independently idempotent/re-runnable
- [ ] No-new-matches case doesn't spam an awkward empty email
- [ ] Gmail auth/quota failure surfaces a visible banner, doesn't fail silently
- [ ] Overlapping cron runs prevented via lock
- [ ] Threshold changes apply forward-only
- [ ] Timezone-aware scheduling and digest windows

## Operational
- [ ] Monitoring page shows last-successful-run per pipeline stage
- [ ] Cost tracking visible to the user
- [ ] Data export available (no lock-in)
- [ ] Production OAuth consent screen out of "testing" mode
- [ ] Serverless-appropriate pooled DB connections (Supabase Supavisor)
- [ ] `CRON_SECRET` matches between Vercel env vars and GitHub Actions repo secret
- [ ] GitHub Actions scheduled workflow verified actually firing in the Actions tab
