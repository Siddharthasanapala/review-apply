"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MatchButton } from "./MatchButton";
import { DraftButton } from "./DraftButton";
import { DismissButton } from "./DismissButton";
import { MarkAppliedButton } from "@/components/MarkAppliedButton";

export interface MatchRow {
  jobId: string;
  title: string;
  company: string;
  location: string | null;
  entryMethod: string;
  likelyExpired: boolean;
  match: {
    id: string;
    score: number | null;
    rationaleText: string | null;
    flags: string[];
    status: string;
  } | null;
  draftId: string | null;
  unfilledPlaceholderCount: number;
}

function StatusTag({ status }: { status: string }) {
  if (status === "applied") {
    return <span className="text-xs font-medium text-green-700 dark:text-green-400">Applied ✓</span>;
  }
  if (status === "dismissed") {
    return <span className="text-xs font-medium text-gray-500 dark:text-gray-500">Dismissed</span>;
  }
  return null;
}

function MatchRowActions({ row, hasProfile }: { row: MatchRow; hasProfile: boolean }) {
  const { match } = row;

  if (!match) {
    return hasProfile ? <MatchButton jobId={row.jobId} /> : null;
  }

  if (match.status === "match_failed") {
    return <span className="text-xs text-red-600 dark:text-red-400">Matching failed — will retry next cycle.</span>;
  }

  if (match.status === "applied" || match.status === "dismissed") {
    return <StatusTag status={match.status} />;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {row.draftId ? (
        <Link href={`/drafts/${row.draftId}`} className="text-xs text-blue-700 underline dark:text-blue-400">
          View draft
        </Link>
      ) : match.status === "new" ? (
        <DraftButton jobMatchId={match.id} />
      ) : null}
      <DismissButton matchId={match.id} />
      <MarkAppliedButton matchId={match.id} unfilledPlaceholderCount={row.unfilledPlaceholderCount} />
    </div>
  );
}

function RowItem({
  row,
  hasProfile,
  selectable,
  selected,
  onToggleSelect,
}: {
  row: MatchRow;
  hasProfile: boolean;
  selectable: boolean;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const { match } = row;
  return (
    <li className="flex flex-col gap-1 py-3 text-sm">
      <div className="flex items-start gap-2">
        {selectable && (
          <input type="checkbox" checked={selected} onChange={onToggleSelect} className="mt-1" aria-label="Select for bulk dismiss" />
        )}
        <div className="flex flex-1 flex-col gap-1">
          <span className="font-medium">
            {row.title} — {row.company}
          </span>
          <span className="text-gray-500 dark:text-gray-400">
            {row.location ?? "Location unknown"} · {row.entryMethod}
            {row.likelyExpired ? " · possibly expired" : ""}
          </span>

          {match && match.score !== null && match.status !== "match_failed" && (
            <div className="flex flex-col gap-1 rounded-md bg-gray-50 p-2 dark:bg-gray-900">
              <span className="font-semibold">Score: {match.score}/100</span>
              {match.rationaleText && <span className="text-gray-700 dark:text-gray-300">{match.rationaleText}</span>}
              {match.flags.length > 0 && (
                <ul className="flex flex-col gap-0.5">
                  {match.flags.map((f, i) => (
                    <li key={i} className="text-amber-700 dark:text-amber-400">
                      ⚠ {f}
                    </li>
                  ))}
                </ul>
              )}
              <MatchRowActions row={row} hasProfile={hasProfile} />
            </div>
          )}

          {match && match.status === "match_failed" && <MatchRowActions row={row} hasProfile={hasProfile} />}
          {!match && <MatchRowActions row={row} hasProfile={hasProfile} />}
        </div>
      </div>
    </li>
  );
}

export function MatchesList({
  rows,
  matchThreshold,
  hasProfile,
}: {
  rows: MatchRow[];
  matchThreshold: number;
  hasProfile: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkState, setBulkState] = useState<"idle" | "loading">("idle");

  const aboveThreshold = rows.filter((r) => !r.match || (r.match.score ?? 0) >= matchThreshold || r.match.status === "match_failed");
  const belowThreshold = rows.filter((r) => r.match && (r.match.score ?? 0) < matchThreshold && r.match.status !== "match_failed");

  function isSelectable(row: MatchRow) {
    return !!row.match && row.match.status !== "applied" && row.match.status !== "dismissed";
  }

  function toggle(matchId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(matchId)) next.delete(matchId);
      else next.add(matchId);
      return next;
    });
  }

  async function bulkDismiss() {
    if (selected.size === 0) return;
    setBulkState("loading");
    await fetch("/api/matches/bulk-dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matchIds: Array.from(selected) }),
    });
    setBulkState("idle");
    setSelected(new Set());
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-md border border-gray-300 bg-gray-50 p-2 text-sm dark:border-gray-700 dark:bg-gray-900">
          <span>{selected.size} selected</span>
          <button
            type="button"
            onClick={bulkDismiss}
            disabled={bulkState === "loading"}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium disabled:opacity-50 dark:border-gray-700"
          >
            {bulkState === "loading" ? "Dismissing…" : "Dismiss selected"}
          </button>
        </div>
      )}

      <ul className="flex flex-col divide-y divide-gray-200 dark:divide-gray-800">
        {aboveThreshold.map((row) => (
          <RowItem
            key={row.jobId}
            row={row}
            hasProfile={hasProfile}
            selectable={isSelectable(row)}
            selected={!!row.match && selected.has(row.match.id)}
            onToggleSelect={() => row.match && toggle(row.match.id)}
          />
        ))}
      </ul>

      {belowThreshold.length > 0 && (
        <details open className="rounded-md border border-gray-200 p-3 dark:border-gray-800">
          <summary className="cursor-pointer text-sm font-medium text-gray-600 dark:text-gray-400">
            Below threshold ({belowThreshold.length}) — scored but under your match threshold
          </summary>
          <ul className="mt-2 flex flex-col divide-y divide-gray-200 dark:divide-gray-800">
            {belowThreshold.map((row) => (
              <RowItem
                key={row.jobId}
                row={row}
                hasProfile={hasProfile}
                selectable={isSelectable(row)}
                selected={!!row.match && selected.has(row.match.id)}
                onToggleSelect={() => row.match && toggle(row.match.id)}
              />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
