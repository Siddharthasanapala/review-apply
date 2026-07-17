import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ManualJobForm } from "./ManualJobForm";

export default async function NewJobPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-xl font-semibold">Add a job manually</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Paste in a job you found yourself — on LinkedIn or anywhere else.
          This app never fetches or logs into LinkedIn; you&apos;re the one
          reading it, this just saves what you paste so it can be matched
          and drafted like any other job.
        </p>
      </div>
      <ManualJobForm />
    </main>
  );
}
