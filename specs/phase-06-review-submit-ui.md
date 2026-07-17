# PHASE 6 — Review & Manual-Submit UI

## Goal
A dashboard where the user reviews match scores and application drafts,
edits anything they want, and is handed off to the real employer/ATS page
to submit the application themselves. This is the phase where
CONSTITUTION.md §1's "human clicks submit, always" rule gets its concrete
UI enforcement — treat it as the most important phase to get right.

## Tasks
1. `/dashboard` — list of job matches, sortable/filterable by score, status,
   date. Each row shows score, company, title, and quick actions
   (view draft / dismiss / mark applied). Include an "Add job manually"
   entry point that links to `/jobs/new` (Phase 2) — this is the primary
   way LinkedIn-specific postings enter the app, so it should be
   prominent, not buried in Settings.
2. `/drafts/[id]` — full review screen:
   - Side-by-side: base resume vs tailored resume (redline view from
     Phase 5).
   - Editable cover letter textarea, pre-filled but fully editable.
   - Screening question answers, editable, with placeholders visually
     distinct (e.g., highlighted) so the user can't miss unfilled ones.
   - A prominent **"Open application on [Company]'s site"** button/link
     that opens the *original job posting URL* in a new tab — this is the
     only "action" button related to submission. There is no "Submit" or
     "Apply" button anywhere in this app that fires a network request to a
     third party on the user's behalf.
   - A **"Mark as Applied"** button the user clicks themselves, after they
     manually submit on the company's site, purely for the user's own
     tracking.
3. `/settings` — manage sources (Phase 2), score threshold (Phase 4),
   resume/portfolio (Phase 3), notification schedule (Phase 7).
4. Status pipeline visible per job: `new → drafted → reviewed → applied /
   dismissed`.

## Edge cases to handle
- **User edits a draft, then the underlying job posting is taken down**
  before they apply — show a "this posting may no longer be live" banner
  (cross-check against Phase 2's `likely_expired` flag) rather than letting
  them click through to a dead link with no warning.
- **Posting legitimacy** (user-raised requirement, see
  12-EDGE-CASES-REGISTRY.md "Fake/scam postings") — surface the source
  trust level (official ATS vs aggregator vs manual entry) and any Phase 4
  legitimacy `flags` clearly on the review screen, not buried, so the user
  can sanity-check an unfamiliar aggregator/manual posting before spending
  time on the application.
- **User wants to bulk-dismiss** low-relevance matches — support bulk
  actions so the review queue doesn't become unmanageable at scale.
- **Draft contains a placeholder the user never filled in** — block "Mark
  as Applied" with a soft warning (not a hard block — it's their tracking,
  their call) if unfilled placeholders remain, e.g. "You have 2 unanswered
  fields — did you mean to leave these blank?"
- **User wants to apply to a job the matching engine scored low** —
  don't hide low-score jobs entirely; make them visible-but-collapsed, with
  an on-demand "draft this anyway" action, since the algorithm isn't
  infallible and the user should stay in control of the funnel.
- **Accessibility/mobile** — the review screen is the highest-friction,
  highest-value screen in the app; make sure diffs and long text render
  reasonably on mobile since the user may review from their phone.

## Exit criteria checklist
- [ ] No code path anywhere in the repo makes an outbound network request
      that submits an application without a preceding explicit user click
      inside a form the user controls (grep the codebase for this before
      calling the phase done)
- [ ] Redline resume view is legible and clearly shows additions/removals
- [ ] Placeholder fields are visually unmissable
- [ ] "Open on company site" always links to the real original posting URL,
      verified against Phase 2 data, not a guessed URL
- [ ] Status pipeline updates correctly through a full manual walkthrough
