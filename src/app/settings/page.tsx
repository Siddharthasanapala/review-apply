import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getLatestProfileDocument } from "@/lib/profile/profileDocuments";
import { ResumeUploadForm } from "./ResumeUploadForm";
import { PortfolioForm } from "./PortfolioForm";
import { SkillsEditor } from "./SkillsEditor";
import { ThresholdSetting } from "./ThresholdSetting";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.email) {
    redirect("/");
  }

  const supabase = getSupabaseServerClient();
  const { data: userRow } = await supabase
    .from("users")
    .select("id, settings")
    .eq("email", session.user.email)
    .single();

  const userId = userRow?.id as string | undefined;
  const matchThreshold =
    ((userRow?.settings as Record<string, unknown> | null)?.matchThreshold as number | undefined) ?? 70;

  const [resume, portfolio] = userId
    ? await Promise.all([
        getLatestProfileDocument(supabase, userId, "resume"),
        getLatestProfileDocument(supabase, userId, "portfolio"),
      ])
    : [null, null];

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 p-8">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Your resume and portfolio are what the matching and drafting
          engines use — keep them current.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Resume</h2>
        {resume ? (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Current version: v{resume.version_number as number} · uploaded{" "}
            {new Date(resume.created_at as string).toLocaleString()}
          </p>
        ) : (
          <p className="text-xs text-gray-500 dark:text-gray-400">No resume uploaded yet.</p>
        )}
        <ResumeUploadForm />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Portfolio</h2>
        {portfolio ? (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Current version: v{portfolio.version_number as number} ·{" "}
            {portfolio.storage_path as string}
          </p>
        ) : (
          <p className="text-xs text-gray-500 dark:text-gray-400">No portfolio linked yet.</p>
        )}
        <PortfolioForm />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Skills</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Extracted automatically from your resume (and merged with your
          portfolio, if linked) — edit freely, your changes are used as-is
          for matching and always take priority over what was extracted.
        </p>
        {/* key forces a remount (resetting SkillsEditor's internal state)
            whenever the underlying resume document changes — otherwise
            React preserves its stale local state across a router.refresh()
            and a "Save skills" click after a re-upload can overwrite fresh
            merged skills with a stale list. Found via real testing in
            Phase 3 (see specs/DECISIONS.md). */}
        <SkillsEditor
          key={(resume?.id as string) ?? "no-resume"}
          initialSkills={(resume?.parsed_skills as string[] | null) ?? []}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Match score threshold</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Jobs scoring at or above this are what future notifications (Phase
          7) will surface. All matches remain visible on the dashboard
          regardless of threshold.
        </p>
        <ThresholdSetting initialThreshold={matchThreshold} />
      </section>
    </main>
  );
}
