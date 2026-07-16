# PHASE 5 — Application Drafting

## Goal
For jobs above the match threshold, auto-generate a tailored resume
(bullet-level edits, not a rewrite from scratch), a cover letter, and draft
answers to common screening questions — all held as **drafts** for human
review, never auto-submitted.

## Tasks
1. Build `/api/draft` (cron-callable), triggered for `job_matches` above
   threshold with `status = 'new'`.
2. Resume tailoring prompt: given base resume text + JD + matched/missing
   skills from Phase 4, ask Gemini to propose *targeted edits* (reorder
   bullets, adjust emphasis, surface relevant keywords truthfully) —
   explicitly instruct it not to fabricate experience, titles, dates, or
   skills the user doesn't have. Output as a diff/redline against the base
   resume, not just a new blob of text, so the user can see exactly what
   changed.
3. Cover letter prompt: short (250–350 words), specific to the company and
   role, referencing 2–3 concrete matched skills/projects — avoid generic
   filler language.
4. Screening-question drafts: if the JD or ATS posting includes common
   questions (years of experience, work authorization, salary expectation),
   draft answers from profile data — but any question requiring a
   judgment call (salary expectation, willingness to relocate) must be
   left as an explicit placeholder for the user to fill in, never guessed.
5. Store all drafts in `application_drafts`, status `draft` until user
   edits/approves.

## Edge cases to handle
- **Fabrication risk** — the single biggest risk in this phase. String-diffing
  won't reliably catch this (a rephrased fabrication won't show up as a
  text diff against the base resume). Implement it as a **second, separate
  Gemini call** acting as a critic: pass it the base resume text and the
  tailored output, and ask it to return a structured list of every factual
  claim (company, title, date range, degree, certification, tool/skill
  claimed as "used professionally") in the tailored version that it cannot
  verify appears, in substance, in the base resume. Treat this critic call
  as adversarial to the drafting call — different prompt, and skeptically
  instructed ("assume the tailored text may contain fabrications; find
  them"). Any non-empty result blocks the draft from being marked
  "approved" until the user reviews each flagged item. Store the critic
  output alongside the draft so the user can see exactly what was flagged
  and why.
- **Salary/compensation questions** — never auto-fill; always placeholder.
- **Work authorization / sponsorship questions** — never auto-fill; always
  placeholder, since getting this wrong has real consequences.
- **Cover letter genericness** — if Gemini's output could apply to any
  company (no specific reference to the JD), regenerate once with a
  stricter prompt before showing to the user.
- **JD requests materials the app doesn't have** (writing sample, specific
  portfolio piece, references) — surface as a to-do for the user rather
  than skipping silently.
- **Rate/cost control** — drafting calls are more expensive than matching;
  only draft for jobs above threshold, and let the user manually trigger
  drafting for below-threshold jobs they're still curious about, rather
  than drafting everything automatically.
- **Multiple versions of base resume** (Phase 3 versioning) — always draft
  from the current version and record which version was used, so later
  edits don't retroactively make old drafts look inconsistent without
  explanation.

## Exit criteria checklist
- [ ] Tailored resume shown as a diff/redline against base, not opaque replacement
- [ ] Fabrication check (separate critic Gemini call) implemented and
      demonstrably catches an injected fake claim during testing
- [ ] Cover letter references specific JD/company details, verified on a
      real posting
- [ ] Salary/sponsorship-type questions always render as placeholders, never auto-filled
- [ ] Draft records which profile version and which job_match produced it
