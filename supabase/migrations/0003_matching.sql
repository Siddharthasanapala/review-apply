-- Phase 4 — Matching Engine
-- Run this in the Supabase SQL Editor after 0001_init.sql and 0002_jobs.sql.

-- Per-user settings (score threshold now; more settings land in later
-- phases — a single jsonb column avoids a new table per setting).
alter table users add column if not exists settings jsonb not null default '{"matchThreshold": 70}'::jsonb;

-- Phase 3 gap found while building Phase 4: extractProfile() has always
-- returned experienceSummary/yearsExperienceByDomain/notableProjects, but
-- only parsed_skills was ever persisted — the rest were silently
-- discarded. Matching needs them as prompt input. Existing rows will have
-- these as null until re-uploaded; that's fine, not backfilled.
alter table profile_documents add column if not exists experience_summary text;
alter table profile_documents add column if not exists years_experience_by_domain jsonb;
alter table profile_documents add column if not exists notable_projects jsonb;

-- Job description embeddings are generated lazily at match time (not
-- during Phase 2 ingestion), so this column starts null and fills in as
-- /api/match processes each job.
alter table jobs add column if not exists embedding vector(768);

create table if not exists job_matches (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  profile_version integer not null,
  score integer,
  rationale_text text,
  matched_skills jsonb not null default '[]'::jsonb,
  missing_skills jsonb not null default '[]'::jsonb,
  seniority_fit text check (seniority_fit in ('under-qualified', 'good-fit', 'over-qualified')),
  flags jsonb not null default '[]'::jsonb,
  status text not null default 'new'
    check (status in ('new', 'reviewed', 'dismissed', 'drafted', 'match_failed')),
  error_text text,
  created_at timestamptz not null default now(),
  -- one match per job per profile version — re-running /api/match is a
  -- no-op for jobs already scored against the current profile.
  unique (job_id, profile_version)
);

create index if not exists job_matches_user_id_idx on job_matches (user_id);
create index if not exists job_matches_job_id_idx on job_matches (job_id);
create index if not exists job_matches_status_idx on job_matches (status);

-- Generic daily call counter for Gemini matching calls, separate from
-- Phase 2's per-job-source ingestion quota (lib/jobs/quota.ts) since
-- matching isn't tied to a job source.
create table if not exists gemini_call_log (
  id uuid primary key default gen_random_uuid(),
  purpose text not null,
  call_date date not null,
  call_count integer not null default 0,
  unique (purpose, call_date)
);
