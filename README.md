# JobPilot

An AI-assisted job-matching and application-drafting tool. It matches job
postings against your resume, drafts a tailored application, and hands it
to you for review — you always click submit yourself. See `specs/` for the
full build plan and non-negotiable rules (`specs/01-CONSTITUTION.md`).

## Phase 1 — Foundation

Sets up: Next.js app, Supabase (Postgres + pgvector + Storage), Google
sign-in, and `CRON_SECRET`-gated stub routes for the pipeline endpoints
that later phases fill in.

### Setup

1. Copy `.env.example` to `.env.local` and fill in every value (see the
   comment above each var for where to get it).
2. Create a Supabase project. In the SQL Editor, run
   `supabase/migrations/0001_init.sql`.
3. In Google Cloud Console, create an OAuth client (Web application),
   with `http://localhost:3000/api/auth/callback/google` as an authorized
   redirect URI for local dev (add the production URL's equivalent once
   deployed).
4. `npm install`
5. `npm run dev`, then open [http://localhost:3000](http://localhost:3000).

### Manual test checklist (Phase 1)

- [ ] `npm run dev` starts without errors given a complete `.env.local`
- [ ] Starting the app with a `.env.local` missing a required var fails
      immediately with a clear error (not a silent misbehavior)
- [ ] Clicking "Sign in with Google" completes the OAuth round-trip and
      lands on `/dashboard`
- [ ] Denying the Google consent screen lands on a clear retry page, not a crash
- [ ] Visiting `/dashboard` while signed out redirects to `/`
- [ ] `/api/health` returns `200` with `{ app: "ok", db: "ok" }` when Supabase is reachable
- [ ] `/api/ingest`, `/api/match`, `/api/draft`, `/api/notify` all return
      `401` when called without a `CRON_SECRET` bearer token, and `501`
      when called with the correct one (expected until their real phases land)
- [ ] Signing in creates a row in Supabase's `users` table

## Learn more about the Next.js template

This project was bootstrapped with `create-next-app`. See
[Next.js Documentation](https://nextjs.org/docs) for framework details.
