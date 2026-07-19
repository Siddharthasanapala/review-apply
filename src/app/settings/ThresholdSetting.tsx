"use client";

import { useState } from "react";

export function ThresholdSetting({ initialThreshold }: { initialThreshold: number }) {
  const [threshold, setThreshold] = useState(initialThreshold);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function save() {
    setSaveState("saving");
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matchThreshold: threshold }),
    });
    setSaveState(res.ok ? "saved" : "error");
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-3 text-sm">
        <input
          type="range"
          min={0}
          max={100}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          className="flex-1"
        />
        <span className="w-10 text-right font-medium">{threshold}</span>
      </label>
      <button
        type="button"
        onClick={save}
        disabled={saveState === "saving"}
        className="self-start rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900"
      >
        {saveState === "saving" ? "Saving…" : "Save threshold"}
      </button>
      {saveState === "saved" && <p className="text-sm text-green-700 dark:text-green-400">Saved.</p>}
      {saveState === "error" && <p className="text-sm text-red-600 dark:text-red-400">Failed to save.</p>}
    </div>
  );
}
