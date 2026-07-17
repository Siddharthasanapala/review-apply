"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "error"; message: string }
  | { status: "success"; message: string };

export function ManualJobForm() {
  const router = useRouter();
  const [state, setState] = useState<SubmitState>({ status: "idle" });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ status: "submitting" });

    const formData = new FormData(event.currentTarget);
    const payload = {
      url: String(formData.get("url") ?? "").trim(),
      company: String(formData.get("company") ?? "").trim() || undefined,
      title: String(formData.get("title") ?? "").trim() || undefined,
      location: String(formData.get("location") ?? "").trim() || undefined,
      descriptionRaw: String(formData.get("descriptionRaw") ?? "").trim() || undefined,
    };

    try {
      const res = await fetch("/api/jobs/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        setState({ status: "error", message: data.error ?? "Something went wrong" });
        return;
      }

      if (data.outcome === "linked_existing") {
        setState({
          status: "success",
          message: "This looks like a job you already have — linked it instead of duplicating.",
        });
      } else {
        setState({ status: "success", message: "Job saved." });
      }

      event.currentTarget.reset();
      router.refresh();
    } catch {
      setState({ status: "error", message: "Network error — please try again." });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Field label="Job URL" name="url" required placeholder="https://www.linkedin.com/jobs/view/..." />
      <Field label="Company" name="company" placeholder="Acme Inc." />
      <Field label="Job title" name="title" placeholder="Senior Software Engineer" />
      <Field label="Location" name="location" placeholder="Remote (US) / New York, NY / Hybrid - SF" />

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Job description</span>
        <textarea
          name="descriptionRaw"
          rows={8}
          placeholder="Paste the job description text here"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
        />
      </label>

      <button
        type="submit"
        disabled={state.status === "submitting"}
        className="self-start rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900"
      >
        {state.status === "submitting" ? "Saving…" : "Save job"}
      </button>

      {state.status === "error" && (
        <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>
      )}
      {state.status === "success" && (
        <p className="text-sm text-green-700 dark:text-green-400">{state.message}</p>
      )}
    </form>
  );
}

function Field({
  label,
  name,
  required,
  placeholder,
}: {
  label: string;
  name: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">
        {label}
        {required ? " *" : ""}
      </span>
      <input
        type="text"
        name={name}
        required={required}
        placeholder={placeholder}
        className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
      />
    </label>
  );
}
