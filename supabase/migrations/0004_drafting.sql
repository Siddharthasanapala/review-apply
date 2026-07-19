-- Phase 5 — Application Drafting
-- Run this in the Supabase SQL Editor after 0001-0003.

create table if not exists application_drafts (
  id uuid primary key default gen_random_uuid(),
  job_match_id uuid not null references job_matches (id) on delete cascade,
  profile_version integer not null,
  tailored_resume_text text,
  -- structured bullet-level changes: [{ section, original, tailored, reason }]
  -- so the UI can render a redline, not just an opaque replacement.
  resume_diff jsonb not null default '[]'::jsonb,
  cover_letter_text text,
  -- [{ question, answer, isPlaceholder, placeholderReason }]
  screening_answers jsonb not null default '[]'::jsonb,
  -- critic-call output: [{ claim, reason }]. Non-empty means this draft
  -- must not be treated as ready-to-use without the user reviewing each
  -- flagged item (full "block approval" UI enforcement lands in Phase 6).
  fabrication_flags jsonb not null default '[]'::jsonb,
  -- things the JD asks for that this app can't draft (writing sample,
  -- references, specific portfolio piece) — surfaced as to-dos, not
  -- silently dropped.
  additional_materials_requested jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'edited', 'applied', 'skipped')),
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  -- one draft per match — re-drafting upserts in place rather than piling up rows.
  unique (job_match_id)
);

create index if not exists application_drafts_job_match_id_idx on application_drafts (job_match_id);
