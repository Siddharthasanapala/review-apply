"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DismissButton({ matchId }: { matchId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  async function handleClick() {
    setState("loading");
    const res = await fetch(`/api/matches/${matchId}/dismiss`, { method: "POST" });
    if (!res.ok) {
      setState("error");
      return;
    }
    setState("idle");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === "loading"}
      className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium disabled:opacity-50 dark:border-gray-700"
    >
      {state === "loading" ? "Dismissing…" : "Dismiss"}
    </button>
  );
}
