import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

export default async function Home() {
  const session = await auth();

  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <div>
        <h1 className="text-2xl font-semibold">JobPilot</h1>
        <p className="mt-2 max-w-sm text-sm text-gray-600 dark:text-gray-400">
          Match job postings against your resume and draft applications for
          review. You always click submit yourself.
        </p>
      </div>
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/dashboard" });
        }}
      >
        <button
          type="submit"
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white dark:bg-gray-100 dark:text-gray-900"
        >
          Sign in with Google
        </button>
      </form>
    </main>
  );
}
