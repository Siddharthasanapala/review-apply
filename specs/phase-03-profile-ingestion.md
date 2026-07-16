# PHASE 3 — Profile Ingestion (Resume & Portfolio)

## Goal
User can upload/link their resume and portfolio; the app extracts text,
parses structured skills/experience, generates an embedding, and stores it
for use by the Matching Engine (Phase 4) and Drafting Engine (Phase 5).

## Tasks
1. Resume upload: accept direct PDF/DOCX file upload, stored in Supabase
   Storage (`storage_path` on `profile_documents`, per ARCHITECTURE.md §3).
   No Google Drive integration — direct upload is simpler and avoids an
   extra incremental-OAuth scope. Extract raw text (use a PDF/DOCX text
   extraction library; do not attempt OCR unless the user uploads a scanned
   image resume — handle that as a fallback path, not the default).
2. Portfolio ingestion: accept a URL (the user's live deployed portfolio).
   Fetch and extract visible text content server-side. Respect
   `robots.txt` even though it's the user's own site — build the habit.
3. Run extracted text through Gemini with a structured-output prompt to
   produce: `skills[]`, `experience_summary`, `years_experience_by_domain`,
   `notable_projects[]`.
4. Generate an embedding of the combined profile text (skills + experience
   + portfolio highlights) for later semantic matching. Store in
   `profile_documents.embedding` (`vector` column, pgvector).
5. Settings UI: let the user view/edit the parsed skills list (LLM
   extraction will sometimes miss or misjudge things — user correction
   should be easy and should persist, overriding the LLM's parse).

## Edge cases to handle
- **PDF with images/columns/tables** (common in designed resumes) — text
  extraction can scramble reading order. Detect low-confidence extraction
  (e.g., very short text relative to page count, or garbled character
  ratio) and prompt the user to paste text manually as a fallback.
- **Portfolio site is JS-rendered (SPA)** — plain HTML fetch returns an
  empty shell. Detect near-empty body content and fall back to asking the
  user to paste a summary, or flag that headless rendering would be needed
  (note: rendering the user's own site is fine; this constraint doesn't
  apply to third-party sites like LinkedIn under CONSTITUTION.md).
- **Resume/portfolio disagree** (portfolio lists a skill the resume
  doesn't, or vice versa) — merge, don't overwrite; keep both as signal for
  matching, and surface the union to the user for confirmation.
- **User updates their resume later** — must re-run extraction and
  re-embed; keep prior version in history (don't destructively overwrite,
  since Phase 4/5 quality regressions should be traceable to a specific
  profile version).
- **Very long resume/portfolio text exceeding prompt limits** — chunk and
  summarize before the structured-extraction call; don't silently truncate.

## Exit criteria checklist
- [ ] Resume upload (PDF/DOCX) works, text extracted and stored
- [ ] Portfolio URL fetch works for a static and a JS-rendered test site,
      with fallback behavior verified on the JS-rendered one
- [ ] Structured skills/experience extraction produces sane output on the
      user's real resume (manually spot-checked)
- [ ] Embedding generated and stored
- [ ] User can edit parsed skills and the edit persists and is used downstream
- [ ] Re-upload creates a new version, not a silent overwrite
