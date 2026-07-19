"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function EditableCoverLetter({ draftId, initialText }: { draftId: string; initialText: string }) {
  const router = useRouter();
  const [text, setText] = useState(initialText);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function save() {
    setSaveState("saving");
    const res = await fetch(`/api/drafts/${draftId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coverLetterText: text }),
    });
    setSaveState(res.ok ? "saved" : "error");
    if (res.ok) router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={12}
        className="rounded-md border border-gray-200 p-3 text-sm dark:border-gray-800 dark:bg-gray-950"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saveState === "saving"}
          className="self-start rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900"
        >
          {saveState === "saving" ? "Saving…" : "Save cover letter"}
        </button>
        {saveState === "saved" && <span className="text-xs text-green-700 dark:text-green-400">Saved.</span>}
        {saveState === "error" && <span className="text-xs text-red-600 dark:text-red-400">Failed to save.</span>}
      </div>
    </div>
  );
}
