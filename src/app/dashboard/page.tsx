import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  const supabase = getSupabaseServerClient();
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, company, title, location, entry_method, likely_expired, last_seen_at")
    .order("last_seen_at", { ascending: false })
    .limit(25);

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
        Signed in as {session.user.email}. Match scores and drafts land here
        starting in Phase 4.
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
            {jobs.map((job) => (
              <li key={job.id as string} className="flex flex-col gap-0.5 py-3 text-sm">
                <span className="font-medium">
                  {job.title as string} — {job.company as string}
                </span>
                <span className="text-gray-500 dark:text-gray-400">
                  {(job.location as string | null) ?? "Location unknown"} ·{" "}
                  {job.entry_method as string}
                  {job.likely_expired ? " · possibly expired" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
