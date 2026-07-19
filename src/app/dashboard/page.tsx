import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getProfileForMatching } from "@/lib/matching/scoreJob";
import { MatchButton } from "./MatchButton";

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user?.email) {
    redirect("/");
  }

  const supabase = getSupabaseServerClient();
  const { data: userRow } = await supabase.from("users").select("id").eq("email", session.user.email).single();
  const userId = userRow?.id as string | undefined;

  const profile = userId ? await getProfileForMatching(supabase, userId) : null;

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
          .select("job_id, score, rationale_text, flags, status")
          .eq("profile_version", profile.version)
          .in("job_id", jobIds)
      : { data: [] };

  const matchByJobId = new Map((matches ?? []).map((m) => [m.job_id as string, m]));

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

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Recent jobs ({jobs?.length ?? 0})
        </h2>
        {!jobs || jobs.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-500">
            No jobs yet — add one manually or wait for the next ingestion run.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-gray-200 dark:divide-gray-800">
            {jobs.map((job) => {
              const match = matchByJobId.get(job.id as string);
              return (
                <li key={job.id as string} className="flex flex-col gap-1 py-3 text-sm">
                  <span className="font-medium">
                    {job.title as string} — {job.company as string}
                  </span>
                  <span className="text-gray-500 dark:text-gray-400">
                    {(job.location as string | null) ?? "Location unknown"} ·{" "}
                    {job.entry_method as string}
                    {job.likely_expired ? " · possibly expired" : ""}
                  </span>

                  {match && match.status === "match_failed" && (
                    <span className="text-xs text-red-600 dark:text-red-400">
                      Matching failed for this job — will retry next cycle.
                    </span>
                  )}

                  {match && match.status !== "match_failed" && match.score !== null && (
                    <div className="flex flex-col gap-1 rounded-md bg-gray-50 p-2 dark:bg-gray-900">
                      <span className="font-semibold">Score: {match.score as number}/100</span>
                      <span className="text-gray-700 dark:text-gray-300">{match.rationale_text as string}</span>
                      {((match.flags as string[] | null) ?? []).length > 0 && (
                        <ul className="flex flex-col gap-0.5">
                          {(match.flags as string[]).map((f, i) => (
                            <li key={i} className="text-amber-700 dark:text-amber-400">
                              ⚠ {f}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {!match && profile && <MatchButton jobId={job.id as string} />}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
