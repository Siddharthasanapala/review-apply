"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PLACEHOLDER_TEXT } from "@/lib/drafting/placeholderText";

export interface ScreeningAnswer {
  question: string;
  answer: string;
  isPlaceholder: boolean;
  placeholderReason?: string;
}

export function EditableScreeningAnswers({
  draftId,
  initialAnswers,
}: {
  draftId: string;
  initialAnswers: ScreeningAnswer[];
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState(initialAnswers);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  function setAnswerText(index: number, text: string) {
    setAnswers((prev) => prev.map((a, i) => (i === index ? { ...a, answer: text } : a)));
  }

  async function save() {
    setSaveState("saving");
    const res = await fetch(`/api/drafts/${draftId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ screeningAnswers: answers }),
    });
    setSaveState(res.ok ? "saved" : "error");
    if (res.ok) router.refresh();
  }

  if (answers.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">None drafted.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {answers.map((a, i) => {
          const isUnfilled = a.isPlaceholder && a.answer.trim() === PLACEHOLDER_TEXT;
          return (
            <li
              key={i}
              className={`rounded-md border p-3 text-sm ${
                isUnfilled
                  ? "border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950"
                  : "border-gray-200 dark:border-gray-800"
              }`}
            >
              <p className="font-medium">{a.question}</p>
              {a.isPlaceholder && (
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                  {isUnfilled ? "⚠ Needs your input — " : "Judgment call — "}
                  {a.placeholderReason ?? "requires your own judgment call"}
                </p>
              )}
              <textarea
                value={a.answer}
                onChange={(e) => setAnswerText(i, e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-md border border-gray-200 p-2 text-sm dark:border-gray-800 dark:bg-gray-950"
              />
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saveState === "saving"}
          className="self-start rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900"
        >
          {saveState === "saving" ? "Saving…" : "Save answers"}
        </button>
        {saveState === "saved" && <span className="text-xs text-green-700 dark:text-green-400">Saved.</span>}
        {saveState === "error" && <span className="text-xs text-red-600 dark:text-red-400">Failed to save.</span>}
      </div>
    </div>
  );
}
