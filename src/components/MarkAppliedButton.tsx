"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Shared between the dashboard row actions and the /drafts/[id] review
// screen. This is purely the user's own tracking action, clicked after
// they've manually submitted on the company's site — CONSTITUTION.md §1:
// nothing in this app ever fires a submission request on the user's behalf.
export function MarkAppliedButton({
  matchId,
  unfilledPlaceholderCount = 0,
}: {
  matchId: string;
  unfilledPlaceholderCount?: number;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  async function handleClick() {
    if (unfilledPlaceholderCount > 0) {
      const proceed = window.confirm(
        `You have ${unfilledPlaceholderCount} unanswered field${unfilledPlaceholderCount === 1 ? "" : "s"} — did you mean to leave ${
          unfilledPlaceholderCount === 1 ? "it" : "these"
        } blank?`,
      );
      if (!proceed) return;
    }

    setState("loading");
    const res = await fetch(`/api/matches/${matchId}/apply`, { method: "POST" });
    if (!res.ok) {
      setState("error");
      return;
    }
    setState("idle");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={state === "loading"}
        className="rounded-md bg-green-700 px-2 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-green-600"
      >
        {state === "loading" ? "Saving…" : "Mark as Applied"}
      </button>
      {state === "error" && <span className="text-xs text-red-600 dark:text-red-400">Failed</span>}
    </div>
  );
}
