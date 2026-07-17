import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export default async function SourcesPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  const supabase = getSupabaseServerClient();
  const { data: sources } = await supabase
    .from("job_sources")
    .select("id, name, type, enabled, base_config")
    .order("name");

  async function toggleSource(formData: FormData) {
    "use server";
    const authedSession = await auth();
    if (!authedSession?.user) return;

    const id = String(formData.get("id"));
    const nextEnabled = formData.get("nextEnabled") === "true";

    const supabase = getSupabaseServerClient();
    await supabase.from("job_sources").update({ enabled: nextEnabled }).eq("id", id);
    revalidatePath("/sources");
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-xl font-semibold">Job sources</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Toggle sources on/off without a redeploy. Company watchlists and
          search params live in each source&apos;s config, edited via
          Supabase for now.
        </p>
      </div>

      <ul className="flex flex-col divide-y divide-gray-200 dark:divide-gray-800">
        {(sources ?? []).map((source) => (
          <li key={source.id as string} className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium">{source.name as string}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {source.type as string}
                {source.name === "manual" ? " (always on)" : ""}
              </p>
            </div>
            {source.name === "manual" ? (
              <span className="text-xs text-gray-400">n/a</span>
            ) : (
              <form action={toggleSource}>
                <input type="hidden" name="id" value={source.id as string} />
                <input
                  type="hidden"
                  name="nextEnabled"
                  value={String(!source.enabled)}
                />
                <button
                  type="submit"
                  className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                    source.enabled
                      ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                      : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                  }`}
                >
                  {source.enabled ? "Enabled" : "Disabled"}
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
