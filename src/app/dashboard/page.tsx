import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getProfileForMatching } from "@/lib/matching/scoreJob";
import { PLACEHOLDER_TEXT } from "@/lib/drafting/placeholderText";
import { DashboardFilters } from "./DashboardFilters";
import { MatchesList, type MatchRow } from "./MatchesList";

interface ScreeningAnswer {
  question: string;
  answer: string;
  isPlaceholder: boolean;
}

function countUnfilledPlaceholders(answers: ScreeningAnswer[] | null): number {
  if (!answers) return 0;
  return answers.filter((a) => a.isPlaceholder && a.answer.trim() === PLACEHOLDER_TEXT).length;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; status?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.email) {
    redirect("/");
  }

  const { sort = "score", status: statusFilter = "active" } = await searchParams;

  const supabase = getSupabaseServerClient();
  const { data: userRow } = await supabase.from("users").select("id, settings").eq("email", session.user.email).single();
  const userId = userRow?.id as string | undefined;

  const profile = userId ? await getProfileForMatching(supabase, userId) : null;
  const matchThreshold =
    ((userRow?.settings as Record<string, unknown> | null)?.matchThreshold as number | undefined) ?? 70;

  let rows: MatchRow[] = [];

  if (userId && (statusFilter === "applied" || statusFilter === "dismissed")) {
    const orderColumn = statusFilter === "applied" ? "applied_at" : "created_at";
    const { data: matches } = await supabase
      .from("job_matches")
      .select("id, job_id, score, rationale_text, flags, status")
      .eq("user_id", userId)
      .eq("status", statusFilter)
      .order(orderColumn, { ascending: false })
      .limit(25);

    const jobIds = (matches ?? []).map((m) => m.job_id as string);
    const { data: jobs } =
      jobIds.length > 0
        ? await supabase.from("jobs").select("id, company, title, location, entry_method, likely_expired").in("id", jobIds)
        : { data: [] };
    const jobById = new Map((jobs ?? []).map((j) => [j.id as string, j]));

    const matchIds = (matches ?? []).map((m) => m.id as string);
    const { data: drafts } =
      matchIds.length > 0
        ? await supabase.from("application_drafts").select("id, job_match_id, screening_answers").in("job_match_id", matchIds)
        : { data: [] };
    const draftByMatchId = new Map((drafts ?? []).map((d) => [d.job_match_id as string, d]));

    rows = (matches ?? []).flatMap((m) => {
      const job = jobById.get(m.job_id as string);
      if (!job) return [];
      const draft = draftByMatchId.get(m.id as string);
      return [
        {
          jobId: job.id as string,
          title: job.title as string,
          company: job.company as string,
          location: job.location as string | null,
          entryMethod: job.entry_method as string,
          likelyExpired: job.likely_expired as boolean,
          match: {
            id: m.id as string,
            score: m.score as number | null,
            rationaleText: m.rationale_text as string | null,
            flags: (m.flags as string[] | null) ?? [],
            status: m.status as string,
          },
          draftId: draft ? (draft.id as string) : null,
          unfilledPlaceholderCount: draft ? countUnfilledPlaceholders(draft.screening_answers as ScreeningAnswer[] | null) : 0,
        },
      ];
    });
  } else {
    const { data: jobs } = await supabase
      .from("jobs")
      .select("id, company, title, location, entry_method, likely_expired, last_seen_at")
      .order("last_seen_at", { ascending: false })
      .limit(25);

    const jobIds = (jobs ?? []).map((j) => j.id as string);
    const { data: matches } =
      profile && jobIds.length > 0
        ? await supabase
            .from("job_matches")
            .select("id, job_id, score, rationale_text, flags, status")
            .eq("profile_version", profile.version)
            .in("job_id", jobIds)
        : { data: [] };

    const matchByJobId = new Map((matches ?? []).map((m) => [m.job_id as string, m]));

    const matchIds = (matches ?? []).map((m) => m.id as string);
    const { data: drafts } =
      matchIds.length > 0
        ? await supabase.from("application_drafts").select("id, job_match_id, screening_answers").in("job_match_id", matchIds)
        : { data: [] };
    const draftByMatchId = new Map((drafts ?? []).map((d) => [d.job_match_id as string, d]));

    rows = (jobs ?? []).flatMap((job) => {
      const m = matchByJobId.get(job.id as string);
      // "active" view: a job whose current match is already applied/dismissed
      // isn't part of the active pipeline anymore — drop it here rather than
      // showing a done/skipped item mixed in with jobs still needing action.
      if (statusFilter === "active" && m && (m.status === "applied" || m.status === "dismissed")) {
        return [];
      }
      const draft = m ? draftByMatchId.get(m.id as string) : undefined;
      return [
        {
          jobId: job.id as string,
          title: job.title as string,
          company: job.company as string,
          location: job.location as string | null,
          entryMethod: job.entry_method as string,
          likelyExpired: job.likely_expired as boolean,
          match: m
            ? {
                id: m.id as string,
                score: m.score as number | null,
                rationaleText: m.rationale_text as string | null,
                flags: (m.flags as string[] | null) ?? [],
                status: m.status as string,
              }
            : null,
          draftId: draft ? (draft.id as string) : null,
          unfilledPlaceholderCount: draft ? countUnfilledPlaceholders(draft.screening_answers as ScreeningAnswer[] | null) : 0,
        },
      ];
    });
  }

  if (sort === "score") {
    rows = [...rows].sort((a, b) => (b.match?.score ?? -1) - (a.match?.score ?? -1));
  }

  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="text-sm text-gray-600 underline dark:text-gray-400"
          >
            Sign out
          </button>
        </form>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Signed in as {session.user.email}.
        {!profile && " Upload a resume in Settings to start getting match scores."}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-3">
          <Link
            href="/jobs/new"
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white dark:bg-gray-100 dark:text-gray-900"
          >
            Add job manually
          </Link>
          <Link
            href="/sources"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium dark:border-gray-700"
          >
            Manage sources
          </Link>
          <Link
            href="/settings"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium dark:border-gray-700"
          >
            Settings
          </Link>
        </div>
        <DashboardFilters sort={sort} status={statusFilter} />
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Jobs ({rows.length})
        </h2>
        {rows.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-500">
            Nothing here — add a job manually or wait for the next ingestion run.
          </p>
        ) : (
          <MatchesList rows={rows} matchThreshold={matchThreshold} hasProfile={!!profile} />
        )}
      </div>
    </main>
  );
}
