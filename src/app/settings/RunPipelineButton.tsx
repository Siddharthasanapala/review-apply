"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const STEPS = [
  { key: "ingest", label: "Ingesting jobs", url: "/api/ingest" },
  { key: "match", label: "Matching", url: "/api/match" },
  { key: "draft", label: "Drafting", url: "/api/draft" },
  { key: "notify", label: "Sending notifications", url: "/api/notify" },
] as const;

type StepStatus = "pending" | "running" | "done" | "error";

export function RunPipelineButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [stepStatus, setStepStatus] = useState<Record<string, StepStatus>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setErrorMessage(null);
    setStepStatus(Object.fromEntries(STEPS.map((s) => [s.key, "pending" as StepStatus])));

    for (const step of STEPS) {
      setStepStatus((prev) => ({ ...prev, [step.key]: "running" }));
      const res = await fetch(step.url, { method: "POST" });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setStepStatus((prev) => ({ ...prev, [step.key]: "error" }));
        setErrorMessage(
          res.status === 409
            ? "A pipeline run is already in progress — try again shortly."
            : (body?.error as string | undefined) ?? `${step.label} failed (HTTP ${res.status})`,
        );
        setRunning(false);
        router.refresh();
        return;
      }

      setStepStatus((prev) => ({ ...prev, [step.key]: "done" }));
    }

    setRunning(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={run}
        disabled={running}
        className="self-start rounded-md border border-gray-300 px-4 py-2 text-sm font-medium disabled:opacity-50 dark:border-gray-700"
      >
        {running ? "Running…" : "Run now"}
      </button>
      {Object.keys(stepStatus).length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-400">
          {STEPS.map((step) => (
            <li key={step.key}>
              {stepStatus[step.key] === "running" && "⏳ "}
              {stepStatus[step.key] === "done" && "✓ "}
              {stepStatus[step.key] === "error" && "✗ "}
              {step.label}
            </li>
          ))}
        </ul>
      )}
      {errorMessage && <p className="text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}
    </div>
  );
}
