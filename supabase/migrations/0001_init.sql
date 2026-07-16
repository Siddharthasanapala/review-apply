-- Phase 1 — Foundation
-- Run this in the Supabase SQL Editor (Project > SQL Editor > New query)
-- for a fresh project. Later phases add their own numbered migration files
-- here; run them in order.

create extension if not exists vector;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  google_id text not null unique,
  email text not null unique,
  portfolio_url text,
  created_at timestamptz not null default now()
);

create table if not exists profile_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  type text not null check (type in ('resume', 'portfolio', 'cover_letter_sample')),
  raw_text text,
  storage_path text,
  parsed_skills jsonb,
  -- Dimension assumes Gemini's text-embedding-004 (768-dim). If Phase 3
  -- picks a different embedding model, alter this column then.
  embedding vector(768),
  version_number integer not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists profile_documents_user_id_idx
  on profile_documents (user_id);
