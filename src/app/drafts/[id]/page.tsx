import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";

interface ResumeChange {
  section: string;
  original: string;
  tailored: string;
  reason: string;
}

interface ScreeningAnswer {
  question: string;
  answer: string;
  isPlaceholder: boolean;
  placeholderReason?: string;
}

interface FabricationFlag {
  claim: string;
  reason: string;
}

// Deliberately plain — a real redline/review UI is Phase 6's job. This
// page exists to inspect and sanity-check drafting output.
export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) {
    redirect("/");
  }

  const { id } = await params;
  const supabase = getSupabaseServerClient();

  const { data: draft } = await supabase.from("application_drafts").select("*").eq("id", id).single();
  if (!draft) notFound();

  const { data: match } = await supabase
    .from("job_matches")
    .select("job_id, score")
    .eq("id", draft.job_match_id)
    .single();
  const { data: job } = match
    ? await supabase.from("jobs").select("title, company, description_url").eq("id", match.job_id).single()
    : { data: null };

  const changes = (draft.resume_diff as ResumeChange[] | null) ?? [];
  const answers = (draft.screening_answers as ScreeningAnswer[] | null) ?? [];
  const fabricationFlags = (draft.fabrication_flags as FabricationFlag[] | null) ?? [];
  const materials = (draft.additional_materials_requested as string[] | null) ?? [];

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 p-8">
      <div>
        <h1 className="text-xl font-semibold">
          {job ? `${job.title} — ${job.company}` : "Draft"}
        </h1>
        {job?.description_url && (
          <a
            href={job.description_url as string}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-700 underline dark:text-blue-400"
          >
            Open original posting
          </a>
        )}
        {match?.score !== undefined && (
          <p className="text-sm text-gray-600 dark:text-gray-400">Match score: {match.score as number}/100</p>
        )}
      </div>

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
        <h2 className="text-sm font-semibold">Resume changes ({changes.length})</h2>
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
        <details>
          <summary className="cursor-pointer text-sm font-medium">Full tailored resume text</summary>
          <pre className="mt-2 whitespace-pre-wrap text-sm">{draft.tailored_resume_text as string}</pre>
        </details>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Cover letter</h2>
        <pre className="whitespace-pre-wrap rounded-md border border-gray-200 p-3 text-sm dark:border-gray-800">
          {draft.cover_letter_text as string}
        </pre>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Screening answers</h2>
        {answers.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">None drafted.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {answers.map((a, i) => (
              <li key={i} className="rounded-md border border-gray-200 p-3 text-sm dark:border-gray-800">
                <p className="font-medium">{a.question}</p>
                <p className={a.isPlaceholder ? "font-semibold text-amber-700 dark:text-amber-400" : ""}>
                  {a.answer}
                </p>
                {a.isPlaceholder && a.placeholderReason && (
                  <p className="text-xs text-amber-600 dark:text-amber-500">{a.placeholderReason}</p>
                )}
              </li>
            ))}
          </ul>
        )}
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
    </main>
  );
}
