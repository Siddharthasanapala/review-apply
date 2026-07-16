import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
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
        Signed in as {session.user.email}. Job matches will show up here
        starting in Phase 2.
      </p>
    </main>
  );
}
