-- Phase 6 — Review & Manual-Submit UI
-- Run this in the Supabase SQL Editor after 0001-0004.

-- Status pipeline (phase-06-review-submit-ui.md): new -> drafted -> reviewed
-- -> applied / dismissed. 'applied' didn't exist yet — Phase 4 only needed
-- new/reviewed/dismissed/drafted/match_failed.
alter table job_matches drop constraint if exists job_matches_status_check;
alter table job_matches add constraint job_matches_status_check
  check (status in ('new', 'reviewed', 'dismissed', 'drafted', 'applied', 'match_failed'));

-- "Mark as Applied" is the user's own tracking action (CONSTITUTION.md
-- §1 — the app never submits anything itself), timestamped for sorting.
alter table job_matches add column if not exists applied_at timestamptz;
