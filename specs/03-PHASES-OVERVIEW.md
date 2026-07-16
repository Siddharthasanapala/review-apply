# PHASES OVERVIEW

| Phase | Name | Depends on | Exit criteria |
|---|---|---|---|
| 1 | Foundation & Project Setup | — | Next.js app deployed to Vercel, DB connected, env vars wired, empty dashboard renders |
| 2 | Job Ingestion (compliant sources + manual entry) | 1 | Cron job pulls from ≥2 real sources, normalizes, dedupes, stores in `jobs`; user can also paste a job (e.g. from LinkedIn) manually via a form |
| 3 | Profile Ingestion (resume/portfolio) | 1 | User can upload resume (PDF/docx) + portfolio URL; text extracted, skills parsed, embedding stored |
| 4 | Matching Engine | 2, 3 | Every new job gets a Gemini-scored match with rationale within N minutes of ingestion |
| 5 | Application Drafting | 3, 4 | Jobs above threshold get an auto-drafted tailored resume + cover letter + screening answers |
| 6 | Review & Manual-Submit UI | 5 | User can view, edit, and mark drafts; app links out to the real application page; no auto-submit exists anywhere in the codebase |
| 7 | Notifications & Scheduling | 2–6 | Daily/periodic digest email sent via Gmail API; GitHub Actions cron orchestrates the full pipeline unattended |
| 8 | Hardening, Edge Cases, Deployment Polish | 1–7 | Edge case registry (file 12) fully addressed; monitoring/logging in place; production deploy checklist passed |

## Suggested pacing
Do not attempt more than one phase per session. Phases 2 and 3 can be built
in parallel sessions since they don't depend on each other. Phase 4 needs
both done. Everything after Phase 6 is refinement, not new risk surface.
