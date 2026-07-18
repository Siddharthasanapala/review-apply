"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type State =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "low-confidence"; reason?: string; extractedText: string; file: File | null }
  | { status: "error"; message: string }
  | { status: "success"; warning?: string };

export function ResumeUploadForm() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ status: "idle" });
  const [editedText, setEditedText] = useState("");

  function handleSaveResponse(data: {
    error?: string;
    lowConfidence?: boolean;
    reason?: string;
    extractedText?: string;
    extractionError?: string;
    embeddingError?: string;
  }, file: File | null) {
    if (data.lowConfidence) {
      setEditedText(data.extractedText ?? "");
      setState({ status: "low-confidence", reason: data.reason, extractedText: data.extractedText ?? "", file });
      return;
    }

    // A 200 response doesn't mean full success — the row can save while
    // skill extraction or embedding failed. Surface that instead of
    // silently reporting "saved" (this was a real bug found in Phase 3
    // testing: a Gemini failure left skills empty with no visible error).
    const problems = [data.extractionError, data.embeddingError].filter(Boolean);
    setState({
      status: "success",
      warning:
        problems.length > 0
          ? `Saved, but: ${problems.join("; ")}. You may want to re-upload to retry.`
          : undefined,
    });
    router.refresh();
  }

  async function submitFile(file: File) {
    setState({ status: "uploading" });
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/profile/resume", { method: "POST", body: formData });
    const data = await res.json();

    if (!res.ok) {
      setState({ status: "error", message: data.error ?? "Upload failed" });
      return;
    }

    handleSaveResponse(data, file);
  }

  async function submitManualText(file: File | null, text: string) {
    setState({ status: "uploading" });
    const formData = new FormData();
    if (file) formData.append("file", file);
    formData.append("manualText", text);

    const res = await fetch("/api/profile/resume", { method: "POST", body: formData });
    const data = await res.json();

    if (!res.ok) {
      setState({ status: "error", message: data.error ?? "Upload failed" });
      return;
    }

    handleSaveResponse(data, file);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) submitFile(file);
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx"
        onChange={handleFileChange}
        disabled={state.status === "uploading"}
        className="text-sm"
      />

      {state.status === "uploading" && <p className="text-sm text-gray-500">Processing…</p>}

      {state.status === "low-confidence" && (
        <div className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            {state.reason ?? "Extraction looked unreliable."} Please review/fix the text below
            before saving.
          </p>
          <textarea
            rows={10}
            value={editedText}
            onChange={(e) => setEditedText(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
          <button
            type="button"
            onClick={() => submitManualText(state.file, editedText)}
            className="self-start rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white dark:bg-gray-100 dark:text-gray-900"
          >
            Save corrected text
          </button>
        </div>
      )}

      {state.status === "error" && (
        <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>
      )}
      {state.status === "success" && !state.warning && (
        <p className="text-sm text-green-700 dark:text-green-400">Resume saved.</p>
      )}
      {state.status === "success" && state.warning && (
        <p className="text-sm text-amber-700 dark:text-amber-400">{state.warning}</p>
      )}
    </div>
  );
}
