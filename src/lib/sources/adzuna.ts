import "server-only";
import { fetchWithRetry } from "@/lib/http/fetchWithRetry";
import { classifyLocation } from "@/lib/jobs/location";
import type { JobSourceAdapter, NormalizedJob, RawListing } from "./types";

export interface AdzunaConfig {
  countries: string[];
  queries: string[];
  resultsPerPage?: number;
}

interface AdzunaResult {
  id: string;
  title: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  description: string;
  redirect_url: string;
  created: string;
}

interface AdzunaSearchResponse {
  results: AdzunaResult[];
}

/**
 * Free tier explicitly permits "personal research" use — verified against
 * developer.adzuna.com/docs/terms_of_service. Requires attributing Adzuna
 * as the source wherever results are shown (handled in the review UI,
 * Phase 6) and respecting documented rate limits (25/min, 250/day,
 * 1000/week, 2500/month).
 *
 * One call is made per (country, query) combination, since Adzuna's `what`
 * param doesn't support multiple independent phrases in one request. Each
 * real call goes through `canMakeCall` first — a per-source daily quota
 * check bound by the caller — so a run stops making new calls once the
 * configured daily cap is hit, rather than erroring out mid-run.
 *
 * app_id / app_key are read from env, never from base_config, per
 * CONSTITUTION.md §3 (secrets are env-vars-only, never stored in the DB).
 */
export function createAdzunaAdapter(
  config: AdzunaConfig,
  canMakeCall: () => Promise<boolean>,
): JobSourceAdapter | null {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;

  if (!appId || !appKey) {
    console.error("Adzuna: ADZUNA_APP_ID / ADZUNA_APP_KEY not set, skipping source");
    return null;
  }

  return {
    name: "adzuna",

    async fetchListings(): Promise<RawListing[]> {
      const perPage = config.resultsPerPage ?? 50;
      const listings: RawListing[] = [];

      for (const country of config.countries) {
        for (const query of config.queries) {
          const allowed = await canMakeCall();
          if (!allowed) {
            console.error(`Adzuna: daily quota reached, skipping remaining calls (stopped at ${country}/"${query}")`);
            return listings;
          }

          try {
            const url = new URL(`https://api.adzuna.com/v1/api/jobs/${encodeURIComponent(country)}/search/1`);
            url.searchParams.set("app_id", appId);
            url.searchParams.set("app_key", appKey);
            url.searchParams.set("results_per_page", String(perPage));
            url.searchParams.set("what", query);
            url.searchParams.set("content-type", "application/json");

            const res = await fetchWithRetry(url.toString());
            if (!res.ok) {
              console.error(`Adzuna: search failed for ${country}/"${query}": ${res.status}`);
              continue;
            }

            const data = (await res.json()) as AdzunaSearchResponse;
            for (const r of data.results ?? []) {
              listings.push({
                externalId: r.id,
                company: r.company?.display_name ?? "Unknown",
                title: r.title,
                location: r.location?.display_name ?? null,
                descriptionRaw: r.description,
                descriptionUrl: r.redirect_url,
                postedAt: r.created,
                raw: r,
              });
            }
          } catch (err) {
            // One (country, query) combo's failure must not block the rest.
            console.error(`Adzuna: fetch error for ${country}/"${query}":`, err);
          }
        }
      }

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
