-- Phase 2 — Job Ingestion
-- Run this in the Supabase SQL Editor after 0001_init.sql.

create table if not exists job_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  type text not null check (type in ('ats_api', 'aggregator_api', 'rss', 'manual')),
  base_config jsonb not null default '{}'::jsonb,
  enabled boolean not null default false,
  created_at timestamptz not null default now()
);

-- (source_id, external_id) is the real uniqueness key for auto-ingested
-- jobs. NULL source_id (manual entries) is never considered equal to
-- another NULL under standard SQL unique-constraint semantics, so manual
-- rows never collide with each other or with auto-ingested rows here.
create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references job_sources (id) on delete set null,
  external_id text,
  company text not null,
  title text not null,
  location text,
  location_type text not null default 'unknown'
    check (location_type in ('remote', 'hybrid', 'onsite', 'unknown')),
  remote_flag boolean not null default false,
  description_raw text,
  description_url text,
  posted_at timestamptz,
  scraped_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  likely_expired boolean not null default false,
  dedupe_hash text not null,
  entry_method text not null default 'auto' check (entry_method in ('auto', 'manual')),
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  unique (source_id, external_id)
);

create index if not exists jobs_dedupe_hash_idx on jobs (dedupe_hash);
create index if not exists jobs_source_id_idx on jobs (source_id);
create index if not exists jobs_last_seen_at_idx on jobs (last_seen_at);

-- Records every OTHER place a canonical `jobs` row was also seen. A job
-- only gets a job_source_links row when a second (or later) sighting is
-- linked to an existing canonical row — see specs/DECISIONS.md for the
-- link-vs-collapse algorithm. Never used to merge/drop a `jobs` row.
create table if not exists job_source_links (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs (id) on delete cascade,
  source_id uuid not null references job_sources (id) on delete cascade,
  source_external_id text,
  source_url text,
  created_at timestamptz not null default now(),
  unique (source_id, source_external_id)
);

create index if not exists job_source_links_job_id_idx on job_source_links (job_id);

-- Simple daily call counter per source, used to degrade gracefully when a
-- source's rate limit (e.g. Adzuna's daily cap) is approaching, rather
-- than erroring out mid-run.
create table if not exists job_source_call_log (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references job_sources (id) on delete cascade,
  call_date date not null,
  call_count integer not null default 0,
  unique (source_id, call_date)
);

-- Seed the sources this app knows about. Real per-company watchlists and
-- API keys are added later (watchlist via base_config, keys via env
-- vars — never committed). All start disabled so nothing fires until
-- explicitly configured and enabled.
insert into job_sources (name, type, base_config, enabled)
values
  ('manual', 'manual', '{}'::jsonb, true),
  ('greenhouse', 'ats_api', '{"companies": []}'::jsonb, false),
  ('adzuna', 'aggregator_api', '{"country": "us", "query": "", "resultsPerPage": 50, "rateLimit": {"maxCallsPerDay": 200}}'::jsonb, false)
on conflict (name) do nothing;
