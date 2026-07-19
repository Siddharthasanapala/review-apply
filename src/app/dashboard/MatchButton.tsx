"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function MatchButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  async function handleClick() {
    setState("loading");
    const res = await fetch(`/api/match/${jobId}`, { method: "POST" });
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
        className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium disabled:opacity-50 dark:border-gray-700"
      >
        {state === "loading" ? "Matching…" : "Match this job now"}
      </button>
      {state === "error" && <span className="text-xs text-red-600 dark:text-red-400">Failed</span>}
    </div>
  );
}
