export type LocationType = "remote" | "hybrid" | "onsite" | "unknown";

/**
 * Normalizes source-specific free text ("Remote (US)", "Hybrid - NYC",
 * "New York, NY") into a consistent enum, per phase-02-ingestion.md's
 * geography/remote-ambiguity edge case. Deliberately simple keyword
 * matching — good enough for a personal job feed, not a general NLP task.
 */
export function classifyLocation(raw: string | null | undefined): {
  locationType: LocationType;
  remoteFlag: boolean;
} {
  if (!raw || !raw.trim()) {
    return { locationType: "unknown", remoteFlag: false };
  }

  const s = raw.toLowerCase();

  if (s.includes("hybrid")) {
    return { locationType: "hybrid", remoteFlag: false };
  }

  if (s.includes("remote")) {
    return { locationType: "remote", remoteFlag: true };
  }

  return { locationType: "onsite", remoteFlag: false };
}
