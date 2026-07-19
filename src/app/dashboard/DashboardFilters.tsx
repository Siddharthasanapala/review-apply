"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

export function DashboardFilters({ sort, status }: { sort: string; status: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function update(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set(key, value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex gap-4 text-sm">
      <label className="flex items-center gap-2">
        Sort by
        <select
          value={sort}
          onChange={(e) => update("sort", e.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1 dark:border-gray-700 dark:bg-gray-900"
        >
          <option value="score">Score</option>
          <option value="date">Date seen</option>
        </select>
      </label>
      <label className="flex items-center gap-2">
        Status
        <select
          value={status}
          onChange={(e) => update("status", e.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1 dark:border-gray-700 dark:bg-gray-900"
        >
          <option value="active">Active (new/drafted/reviewed)</option>
          <option value="applied">Applied</option>
          <option value="dismissed">Dismissed</option>
          <option value="all">All</option>
        </select>
      </label>
    </div>
  );
}
