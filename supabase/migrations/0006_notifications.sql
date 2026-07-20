-- Phase 7 — Notifications & Scheduling
-- Run this in the Supabase SQL Editor after 0001-0005.

-- Gmail refresh token captured via incremental OAuth consent (requested
-- only when the user enables notifications in Settings — see src/auth.ts's
-- signIn callback). Auth/quota failure state lives alongside it so a
-- broken connection surfaces as a dashboard banner rather than silently
-- dropping notifications (phase-07-notifications-scheduling.md edge case).
alter table users add column if not exists google_refresh_token text;
alter table users add column if not exists notifications_paused boolean not null default false;
alter table users add column if not exists notifications_paused_reason text;
alter table users add column if not exists last_notified_at timestamptz;

-- One row per digest attempt, including "nothing to send" — lets us tell
-- "notifications are configured but nothing new happened" apart from
-- "notifications are silently broken" when looking at history.
create table if not exists notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  sent_at timestamptz not null default now(),
  status text not null check (status in ('sent', 'skipped_no_matches', 'failed')),
  job_match_count integer not null default 0,
  error_text text
);

create index if not exists notification_log_user_id_idx on notification_log (user_id);

-- Simple DB-based lock so the manual "Run now" button can't overlap a
-- scheduled GitHub Actions run (GitHub Actions itself won't double-queue
-- the same scheduled workflow, but that guarantee doesn't cover a human
-- clicking "Run now" mid-cycle). /api/ingest acquires this; /api/notify
-- releases it, since those are the pipeline's first and last steps.
create table if not exists pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  trigger text not null check (trigger in ('cron', 'manual')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_text text
);

create index if not exists pipeline_runs_started_at_idx on pipeline_runs (started_at desc);
