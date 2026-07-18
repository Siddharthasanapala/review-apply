"use client";

import { useState } from "react";

type SaveState = "idle" | "saving" | "saved" | "error";

export function SkillsEditor({ initialSkills }: { initialSkills: string[] }) {
  const [skills, setSkills] = useState<string[]>(initialSkills);
  const [draft, setDraft] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");

  function addSkill() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (skills.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
      setDraft("");
      return;
    }
    setSkills([...skills, trimmed]);
    setDraft("");
  }

  function removeSkill(skill: string) {
    setSkills(skills.filter((s) => s !== skill));
  }

  async function save() {
    setSaveState("saving");
    const res = await fetch("/api/profile/skills", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skills }),
    });
    setSaveState(res.ok ? "saved" : "error");
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {skills.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No skills yet — upload a resume first, or add some manually below.
          </p>
        )}
        {skills.map((skill) => (
          <span
            key={skill}
            className="flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs dark:bg-gray-800"
          >
            {skill}
            <button
              type="button"
              onClick={() => removeSkill(skill)}
              aria-label={`Remove ${skill}`}
              className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
            >
              ×
            </button>
          </span>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addSkill();
            }
          }}
          placeholder="Add a skill and press Enter"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
        />
        <button
          type="button"
          onClick={addSkill}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700"
        >
          Add
        </button>
      </div>

      <button
        type="button"
        onClick={save}
        disabled={saveState === "saving"}
        className="self-start rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900"
      >
        {saveState === "saving" ? "Saving…" : "Save skills"}
      </button>
      {saveState === "saved" && (
        <p className="text-sm text-green-700 dark:text-green-400">Saved.</p>
      )}
      {saveState === "error" && (
        <p className="text-sm text-red-600 dark:text-red-400">Failed to save — try again.</p>
      )}
    </div>
  );
}
