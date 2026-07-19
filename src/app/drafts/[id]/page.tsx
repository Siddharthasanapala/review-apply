import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { MarkAppliedButton } from "@/components/MarkAppliedButton";
import { PLACEHOLDER_TEXT } from "@/lib/drafting/placeholderText";
import { EditableCoverLetter } from "./EditableCoverLetter";
import { EditableScreeningAnswers, type ScreeningAnswer } from "./EditableScreeningAnswers";

interface ResumeChange {
  section: string;
  original: string;
  tailored: string;
  reason: string;
}

interface FabricationFlag {
  claim: string;
  reason: string;
}

// This is the highest-friction, highest-value screen in the app
// (phase-06-review-submit-ui.md) — the redline view, editable cover
// letter/screening answers, legitimacy flags, and the single
// "open on company site" handoff all live here. There is no submit
// button that fires a network request on the user's behalf anywhere in
// this app (CONSTITUTION.md §1) — "Open application" just opens the
// original posting URL in a new tab, and "Mark as Applied" only writes
// to this app's own tracking state.
export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) {
    redirect("/");
  }

  const { id } = await params;
  const supabase = getSupabaseServerClient();

  const { data: userRow } = await supabase.from("users").select("id").eq("email", session.user.email).single();

  const { data: draft } = await supabase.from("application_drafts").select("*").eq("id", id).single();
  if (!draft) notFound();

  const { data: match } = await supabase
    .from("job_matches")
    .select("job_id, user_id, score, status, flags, seniority_fit")
    .eq("id", draft.job_match_id)
    .single();

  if (!match || match.user_id !== userRow?.id) notFound();

  const { data: job } = await supabase
    .from("jobs")
    .select("title, company, description_url, entry_method, likely_expired, source_id")
    .eq("id", match.job_id)
    .single();
  if (!job) notFound();

  const { data: source } = job.source_id
    ? await supabase.from("job_sources").select("type").eq("id", job.source_id).single()
    : { data: null };

  const { data: baseResume } = await supabase
    .from("profile_documents")
    .select("raw_text")
    .eq("user_id", match.user_id)
    .eq("type", "resume")
    .eq("version_number", draft.profile_version)
    .maybeSingle();

  // Viewing the draft is unambiguous evidence of review — bump the
  // pipeline forward if it's still sitting at "drafted".
  if (match.status === "drafted") {
    await supabase.from("job_matches").update({ status: "reviewed" }).eq("id", draft.job_match_id);
  }

  const changes = (draft.resume_diff as ResumeChange[] | null) ?? [];
  const answers = (draft.screening_answers as ScreeningAnswer[] | null) ?? [];
  const fabricationFlags = (draft.fabrication_flags as FabricationFlag[] | null) ?? [];
  const materials = (draft.additional_materials_requested as string[] | null) ?? [];
  const matchFlags = (match.flags as string[] | null) ?? [];
  const unfilledCount = answers.filter((a) => a.isPlaceholder && a.answer.trim() === PLACEHOLDER_TEXT).length;

  const sourceLabel =
    job.entry_method === "manual"
      ? "Manually entered"
      : source?.type === "ats_api"
        ? "Official company ATS"
        : source?.type === "aggregator_api"
          ? "Job aggregator"
          : "Unknown source";

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 p-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">
          {job.title} — {job.company}
        </h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600 dark:text-gray-400">
          {match.score !== null && <span>Match score: {match.score}/100</span>}
          {match.seniority_fit && <span>· {match.seniority_fit}</span>}
          <span>· Status: {match.status}</span>
        </div>
      </div>

      {job.likely_expired && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          ⚠ This posting may no longer be live — it hasn&apos;t been seen in the most recent ingestion runs.
        </div>
      )}

      <section className="flex flex-col gap-2 rounded-md border border-gray-200 p-4 dark:border-gray-800">
        <h2 className="text-sm font-semibold">Source &amp; legitimacy</h2>
        <p className="text-sm">
          <span className="font-medium">{sourceLabel}</span>
          {sourceLabel !== "Official company ATS" &&
            " — not independently verified. Confirm the company/posting is legitimate before applying."}
        </p>
        {matchFlags.length > 0 && (
          <ul className="flex flex-col gap-0.5 text-sm">
            {matchFlags.map((f, i) => (
              <li key={i} className="text-amber-700 dark:text-amber-400">
                ⚠ {f}
              </li>
            ))}
          </ul>
        )}
      </section>

      {fabricationFlags.length > 0 && (
        <section className="flex flex-col gap-2 rounded-md border border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
          <h2 className="text-sm font-semibold text-red-800 dark:text-red-200">
            ⚠ Fabrication check flagged {fabricationFlags.length} claim(s) — review before using this draft
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {fabricationFlags.map((f, i) => (
              <li key={i} className="text-red-700 dark:text-red-300">
                <strong>{f.claim}</strong> — {f.reason}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Resume</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">Base resume</p>
            <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-md border border-gray-200 p-3 text-xs dark:border-gray-800">
              {(baseResume?.raw_text as string | null) ?? "(base resume text unavailable)"}
            </pre>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">Tailored resume</p>
            <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-md border border-gray-200 p-3 text-xs dark:border-gray-800">
              {(draft.tailored_resume_text as string | null) ?? ""}
            </pre>
          </div>
        </div>

        <p className="mt-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
          Changes ({changes.length})
        </p>
        {changes.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No changes proposed.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {changes.map((c, i) => (
              <li key={i} className="rounded-md border border-gray-200 p-3 text-sm dark:border-gray-800">
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">{c.section}</p>
                <p className="text-red-700 line-through dark:text-red-400">{c.original}</p>
                <p className="text-green-700 dark:text-green-400">{c.tailored}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Why: {c.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Cover letter</h2>
        <EditableCoverLetter draftId={draft.id as string} initialText={(draft.cover_letter_text as string | null) ?? ""} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Screening answers</h2>
        <EditableScreeningAnswers draftId={draft.id as string} initialAnswers={answers} />
      </section>

      {materials.length > 0 && (
        <section className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
          <h2 className="text-sm font-semibold text-amber-800 dark:text-amber-200">
            The posting also asks for:
          </h2>
          <ul className="text-sm text-amber-700 dark:text-amber-300">
            {materials.map((m, i) => (
              <li key={i}>• {m}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col items-start gap-3 rounded-md border border-gray-300 p-4 dark:border-gray-700">
        <h2 className="text-sm font-semibold">Submit — you do this yourself</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          This app never submits anything on your behalf. Open the real posting, apply there yourself using the
          materials above, then mark it applied here for your own tracking.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {job.description_url && (
            <a
              href={job.description_url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white dark:bg-gray-100 dark:text-gray-900"
            >
              Open application on {job.company}&apos;s site
            </a>
          )}
          {match.status !== "applied" && match.status !== "dismissed" && (
            <MarkAppliedButton matchId={draft.job_match_id as string} unfilledPlaceholderCount={unfilledCount} />
          )}
          {match.status === "applied" && <span className="text-sm font-medium text-green-700 dark:text-green-400">Applied ✓</span>}
        </div>
      </section>
    </main>
  );
}
