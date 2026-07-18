"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type State =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "low-confidence"; reason?: string; extractedText: string; url: string }
  | { status: "error"; message: string }
  | { status: "success"; warning?: string };

export function PortfolioForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const [editedText, setEditedText] = useState("");

  function handleSaveResponse(data: {
    lowConfidence?: boolean;
    reason?: string;
    extractedText?: string;
    extractionError?: string;
    embeddingError?: string;
  }, sourceUrl: string) {
    if (data.lowConfidence) {
      setEditedText(data.extractedText ?? "");
      setState({ status: "low-confidence", reason: data.reason, extractedText: data.extractedText ?? "", url: sourceUrl });
      return;
    }

    const problems = [data.extractionError, data.embeddingError].filter(Boolean);
    setState({
      status: "success",
      warning:
        problems.length > 0
          ? `Saved, but: ${problems.join("; ")}. You may want to try again.`
          : undefined,
    });
    setUrl("");
    router.refresh();
  }

  async function submitUrl(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState({ status: "submitting" });

    const res = await fetch("/api/profile/portfolio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();

    if (!res.ok) {
      setState({ status: "error", message: data.error ?? "Failed to fetch portfolio" });
      return;
    }

    handleSaveResponse(data, url);
  }

  async function submitManualText(sourceUrl: string, text: string) {
    setState({ status: "submitting" });

    const res = await fetch("/api/profile/portfolio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: sourceUrl, manualText: text }),
    });
    const data = await res.json();

    if (!res.ok) {
      setState({ status: "error", message: data.error ?? "Failed to save portfolio" });
      return;
    }

    handleSaveResponse(data, sourceUrl);
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={submitUrl} className="flex gap-2">
        <input
          type="url"
          required
          placeholder="https://your-portfolio.example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={state.status === "submitting"}
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
        />
        <button
          type="submit"
          disabled={state.status === "submitting"}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900"
        >
          {state.status === "submitting" ? "Fetching…" : "Link portfolio"}
        </button>
      </form>

      {state.status === "low-confidence" && (
        <div className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            {state.reason ?? "This looks like a JS-rendered site — little visible text found."}{" "}
            Paste a short summary of your portfolio instead.
          </p>
          <textarea
            rows={6}
            value={editedText}
            onChange={(e) => setEditedText(e.target.value)}
            placeholder="Briefly describe your projects, skills highlighted on your portfolio, etc."
            className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
          <button
            type="button"
            onClick={() => submitManualText(state.url, editedText)}
            className="self-start rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white dark:bg-gray-100 dark:text-gray-900"
          >
            Save summary
          </button>
        </div>
      )}

      {state.status === "error" && (
        <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>
      )}
      {state.status === "success" && !state.warning && (
        <p className="text-sm text-green-700 dark:text-green-400">Portfolio saved.</p>
      )}
      {state.status === "success" && state.warning && (
        <p className="text-sm text-amber-700 dark:text-amber-400">{state.warning}</p>
      )}
    </div>
  );
}
