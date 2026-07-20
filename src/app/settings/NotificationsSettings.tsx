"use client";

import { useState } from "react";

function getTimezoneOptions(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
}

export function NotificationsSettings({
  initialEnabled,
  initialTimezone,
  gmailConnected,
}: {
  initialEnabled: boolean;
  initialTimezone: string;
  gmailConnected: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [timezone, setTimezone] = useState(initialTimezone);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [timezoneOptions] = useState(getTimezoneOptions);

  async function save() {
    setSaveState("saving");
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notificationsEnabled: enabled, timezone }),
    });
    setSaveState(res.ok ? "saved" : "error");
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!gmailConnected}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Email me a digest of new high-match jobs
      </label>
      {!gmailConnected && (
        <p className="text-xs text-gray-500 dark:text-gray-400">Connect Gmail above before enabling this.</p>
      )}

      <label className="flex items-center gap-2 text-sm">
        Timezone (for display in the digest)
        <select
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900"
        >
          {timezoneOptions.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        onClick={save}
        disabled={saveState === "saving"}
        className="self-start rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900"
      >
        {saveState === "saving" ? "Saving…" : "Save notification settings"}
      </button>
      {saveState === "saved" && <p className="text-sm text-green-700 dark:text-green-400">Saved.</p>}
      {saveState === "error" && <p className="text-sm text-red-600 dark:text-red-400">Failed to save.</p>}
    </div>
  );
}
