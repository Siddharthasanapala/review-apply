import { signIn } from "@/auth";

// Incremental OAuth consent (phase-07 task 1) — requests the Gmail `send`
// scope only when the user explicitly opts in here, not at every sign-in.
// access_type=offline + prompt=consent force Google to hand back a
// refresh_token, which is what lets /api/notify send digests later without
// a live user session.
export function ConnectGmailButton({ label }: { label: string }) {
  async function connect() {
    "use server";
    await signIn(
      "google",
      { redirectTo: "/settings" },
      {
        scope: "openid email profile https://www.googleapis.com/auth/gmail.send",
        access_type: "offline",
        prompt: "consent",
      },
    );
  }

  return (
    <form action={connect}>
      <button
        type="submit"
        className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-gray-100 dark:text-gray-900"
      >
        {label}
      </button>
    </form>
  );
}
