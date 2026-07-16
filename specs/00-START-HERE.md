# START HERE — How to Use This Spec Pack

This folder is a **spec-driven build kit** for an AI-powered job-matching and
application-drafting assistant ("JobPilot"). It is designed to be fed to
Claude (Claude Code, or Claude in a fresh chat with file upload) **one phase
at a time**, not all at once.

## Why phased, not all-at-once
LLM coding agents drift and cut corners when given a huge spec in one shot.
Feeding one phase's `.md` file per session, with the constitution and
architecture doc pinned as permanent context, keeps the agent honest and
gives you a natural review/checkpoint gate after every phase.

## Files in this pack

| # | File | Purpose |
|---|---|---|
| 01 | CONSTITUTION.md | Non-negotiable rules. Paste this into every session. |
| 02 | ARCHITECTURE.md | System design, data model, folder structure. Paste into every session. |
| 03 | PHASES-OVERVIEW.md | Map of all phases, dependencies, exit criteria. |
| 04–11 | phase-01 … phase-08 | One detailed spec per build phase. Feed ONE at a time. |
| 12 | EDGE-CASES-REGISTRY.md | Living list of failure modes, referenced by every phase. |
| 13 | AGENT-INSTRUCTIONS.md | Strict operating instructions for the coding LLM — paste as system/first message. |

## Recommended workflow per phase

1. Start a **new** Claude Code session (or new chat).
2. Paste, in order: `AGENT-INSTRUCTIONS.md` → `CONSTITUTION.md` →
   `ARCHITECTURE.md` → the specific `phase-0X-*.md` file.
3. Add: *"Implement only this phase. Do not start the next phase. Stop and
   summarize what you built, what you skipped, and any open questions before
   ending your turn."*
4. Review the diff/output yourself. Run the phase's exit-criteria checklist.
5. Commit. Only then move to the next phase file.
6. If the agent proposes deviating from CONSTITUTION.md (e.g., "I could speed
   this up by logging into LinkedIn directly"), reject it — that document is
   the hard boundary, not a suggestion.

## What this system does and does not do

**Does:** continuously pull job postings from compliant sources, score them
against your resume/portfolio using Gemini, draft a tailored resume +
cover letter + answers, and queue them for your one-click review and submit.

**Does not:** log into LinkedIn programmatically, scrape LinkedIn's website,
or submit applications without your explicit click. See CONSTITUTION.md
§1 for why this line exists and is not negotiable.
