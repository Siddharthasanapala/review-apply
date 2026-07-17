import "server-only";
import { fetchWithRetry } from "@/lib/http/fetchWithRetry";
import { mapWithConcurrency } from "@/lib/http/mapWithConcurrency";
import { classifyLocation } from "@/lib/jobs/location";
import type { JobSourceAdapter, NormalizedJob, RawListing } from "./types";

export interface GreenhouseConfig {
  companies: Array<{ slug: string; displayName: string }>;
  /**
   * Case-insensitive, word-boundary title filter. Real company boards can
   * carry hundreds of listings across every department (sales, legal,
   * support, etc.) — without this, ingestion pulls far more than a
   * personal job feed needs. Empty/omitted means no filtering.
   */
  titleKeywords?: string[];
}

interface GreenhouseJobSummary {
  id: number;
  title: string;
  absolute_url: string;
  location?: { name?: string };
  updated_at?: string;
}

interface GreenhouseJobDetail extends GreenhouseJobSummary {
  content?: string;
}

interface GreenhouseBoardResponse {
  jobs: GreenhouseJobSummary[];
}

const LIST_CONCURRENCY = 10;
const DETAIL_CONCURRENCY = 15;

/**
 * Public, unauthenticated Job Board API — verified at build time to
 * require no auth for GET requests (developers.greenhouse.io/job-board.html).
 * No published rate limit; concurrency is bounded (not unlimited-parallel)
 * as a courtesy since none is published, and requests are spread across a
 * cron-scheduled run rather than hammered on every page view.
 *
 * Two-step fetch: list endpoints WITHOUT `content=true` are ~10x smaller
 * (verified: 313KB vs 3.9MB for one real company board) and have
 * everything needed to title-filter. Full descriptions are only fetched
 * for listings that pass the filter (verified: ~5-7% of listings match a
 * typical role-keyword filter), and those detail fetches run with bounded
 * concurrency rather than sequentially — a real 37-company run generates
 * a few hundred detail fetches, which serially would take minutes and
 * blow past a serverless function's time limit (verified during Phase 2
 * testing, see specs/DECISIONS.md).
 */
export function createGreenhouseAdapter(config: GreenhouseConfig): JobSourceAdapter {
  const keywordMatchers = (config.titleKeywords ?? []).map(
    (kw) => new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"),
  );

  function titleMatches(title: string): boolean {
    if (keywordMatchers.length === 0) return true;
    return keywordMatchers.some((re) => re.test(title));
  }

  return {
    name: "greenhouse",

    async fetchListings(): Promise<RawListing[]> {
      const perCompanyMatches = await mapWithConcurrency(
        config.companies,
        LIST_CONCURRENCY,
        async ({ slug, displayName }) => {
          const listRes = await fetchWithRetry(
            `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`,
          );

          if (!listRes.ok) {
            console.error(`Greenhouse: ${slug} list returned ${listRes.status}`);
            return [];
          }

          const listData = (await listRes.json()) as GreenhouseBoardResponse;
          return (listData.jobs ?? [])
            .filter((job) => titleMatches(job.title))
            .map((job) => ({ slug, displayName, jobId: job.id }));
        },
        (item, err) => console.error(`Greenhouse: list fetch error for ${item.slug}:`, err),
      );

      const matchedStubs = perCompanyMatches.flat();

      const listings = await mapWithConcurrency(
        matchedStubs,
        DETAIL_CONCURRENCY,
        async ({ slug, displayName, jobId }): Promise<RawListing> => {
          const detailRes = await fetchWithRetry(
            `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs/${jobId}?content=true`,
          );

          if (!detailRes.ok) {
            throw new Error(`detail fetch returned ${detailRes.status}`);
          }

          const detail = (await detailRes.json()) as GreenhouseJobDetail;

          return {
            externalId: String(detail.id),
            company: displayName,
            title: detail.title,
            location: detail.location?.name ?? null,
            descriptionRaw: stripHtml(detail.content ?? ""),
            descriptionUrl: detail.absolute_url,
            postedAt: detail.updated_at ?? null,
            raw: detail,
          };
        },
        (item, err) => console.error(`Greenhouse: detail fetch error for ${item.slug}/${item.jobId}:`, err),
      );

      return listings;
    },

    normalize(raw: RawListing): NormalizedJob {
      const { locationType, remoteFlag } = classifyLocation(raw.location);
      return {
        externalId: raw.externalId,
        company: raw.company,
        title: raw.title,
        location: raw.location,
        locationType,
        remoteFlag,
        descriptionRaw: raw.descriptionRaw,
        descriptionUrl: raw.descriptionUrl,
        postedAt: raw.postedAt,
        raw: raw.raw,
      };
    },
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
