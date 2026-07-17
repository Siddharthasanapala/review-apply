import type { LocationType } from "@/lib/jobs/location";

export interface RawListing {
  externalId: string;
  company: string;
  title: string;
  location: string | null;
  descriptionRaw: string;
  descriptionUrl: string;
  postedAt: string | null;
  raw: unknown;
}

export interface NormalizedJob {
  externalId: string;
  company: string;
  title: string;
  location: string | null;
  locationType: LocationType;
  remoteFlag: boolean;
  descriptionRaw: string;
  descriptionUrl: string;
  postedAt: string | null;
  raw: unknown;
}

/**
 * One adapter file per job source (ARCHITECTURE.md §5). Adding/removing a
 * source is a one-file change, not a rewrite.
 */
export interface JobSourceAdapter {
  name: string;
  fetchListings(): Promise<RawListing[]>;
  normalize(raw: RawListing): NormalizedJob;
}
