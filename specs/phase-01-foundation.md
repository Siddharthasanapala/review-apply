# PHASE 1 — Foundation & Project Setup

## Goal
A deployable skeleton: Next.js app on Vercel, Supabase (Postgres +
pgvector + Storage) connected, Google OAuth working for sign-in,
environment variables wired, empty dashboard page renders after login. No
job logic yet.

## Tasks
1. Scaffold Next.js (App Router, TypeScript, Tailwind).
2. Create a Supabase project. Enable the `pgvector` extension. Note the
   project's Postgres connection string and Storage bucket setup — this is
   locked in per CONSTITUTION.md §5, don't revisit later.
3. Write initial schema migration for `users` and `profile_documents`
   tables only (rest come in later phases — don't pre-build unused tables).
   `profile_documents.embedding` should use the `vector` column type.
4. Wire NextAuth.js / Auth.js with Google provider. Scopes needed now:
   `openid email profile`. (Gmail send scope is added in Phase 7 — request
   incrementally, not upfront. No Drive scope is ever needed — file storage
   is Supabase Storage, not Drive.)
5. Add the `CRON_SECRET` env var and a shared helper
   (`lib/auth/verifyCronSecret.ts` or similar) that checks
   `Authorization: Bearer $CRON_SECRET` on a request. Stub the four
   cron-triggered routes (`/api/ingest`, `/api/match`, `/api/draft`,
   `/api/notify`) as empty handlers that call this check first and
   otherwise return `501 Not Implemented` — the real logic lands in later
   phases, but the auth gate must exist from day one (ARCHITECTURE.md §7).
6. Deploy to Vercel. Confirm the deployed URL loads and Google sign-in
   round-trips correctly.
7. Add a `/specs/DECISIONS.md` log file — every phase should append a short
   entry recording any nontrivial choice made (cron mechanism, Gemini model
   tier, etc.) so future sessions don't re-litigate it. Log the Supabase and
   GitHub Actions decisions now.
8. Add `.env.example` listing every env var the project will eventually
   need (even ones not used until later phases), each with a one-line
   comment on where to obtain it.

## Env vars to stub now
```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=              # Supabase Postgres connection string (pooled, see Phase 8 note)
NEXTAUTH_URL=
NEXTAUTH_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GEMINI_API_KEY=
CRON_SECRET=                # shared secret for GitHub Actions -> API route calls
# job source keys added in Phase 2
```

## Edge cases to handle in this phase
- OAuth callback fails / user denies permission → show a clear retry screen,
  don't crash.
- DB connection fails on cold start → health check endpoint (`/api/health`)
  that reports DB status distinctly from app status.
- Vercel deployment with missing env var → app should fail loudly at build/
  boot time with a clear message, not silently misbehave at runtime.
- Cron routes hit without a valid `CRON_SECRET` → `401`, not a silent
  no-op and not a stack trace.

## Exit criteria checklist
- [ ] `npm run dev` works locally
- [ ] Deployed on Vercel, publicly reachable
- [ ] Google sign-in works end-to-end on the deployed URL
- [ ] `/api/health` returns DB + app status
- [ ] Cron route stubs exist and reject requests without a valid `CRON_SECRET`
- [ ] `/specs/DECISIONS.md` created with Phase 1 decisions logged
- [ ] No job/matching/drafting code written yet (scope discipline)
