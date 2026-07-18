import "server-only";
import { fetchWithRetry } from "@/lib/http/fetchWithRetry";

export type PortfolioFetchResult =
  | { ok: true; text: string; lowConfidence: boolean; reason?: string }
  | { ok: false; error: string };

const MIN_VISIBLE_TEXT_LENGTH = 200;

/**
 * Fetches the user's own portfolio URL server-side and extracts visible
 * text. Respects robots.txt even though it's the user's own site — "build
 * the habit" per phase-03-profile-ingestion.md. This is explicitly scoped
 * to the user's own site; CONSTITUTION.md's no-scraping rule is about
 * third-party platforms like LinkedIn, not this.
 */
export async function fetchPortfolioText(url: string): Promise<PortfolioFetchResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "Invalid URL" };
  }

  const disallowed = await isDisallowedByRobots(parsed);
  if (disallowed) {
    return { ok: false, error: "This site's robots.txt disallows fetching this path." };
  }

  let html: string;
  try {
    const res = await fetchWithRetry(parsed.toString(), {
      headers: { "User-Agent": "JobPilotBot/1.0 (personal job-matching assistant, fetching owner's own site)" },
    });
    if (!res.ok) {
      return { ok: false, error: `Fetch failed with status ${res.status}` };
    }
    html = await res.text();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Fetch failed" };
  }

  const text = extractVisibleText(html);

  if (text.length < MIN_VISIBLE_TEXT_LENGTH) {
    return {
      ok: true,
      text,
      lowConfidence: true,
      reason:
        "Very little visible text found — this may be a JS-rendered (SPA) site that returns an empty shell on a plain fetch. Paste a summary manually instead.",
    };
  }

  return { ok: true, text, lowConfidence: false };
}

async function isDisallowedByRobots(url: URL): Promise<boolean> {
  try {
    const robotsUrl = new URL("/robots.txt", url.origin);
    const res = await fetchWithRetry(robotsUrl.toString(), undefined, { retries: 1, timeoutMs: 5000 });
    if (!res.ok) return false;

    const body = await res.text();
    return isPathDisallowed(body, url.pathname);
  } catch {
    // No robots.txt or unreachable — treat as allowed, same as most crawlers do.
    return false;
  }
}

/**
 * Minimal robots.txt check: applies "User-agent: *" Disallow rules to the
 * given path. Not a full RFC 9309 parser — proportionate to this feature's
 * purpose (habit-building on the user's own site), not a compliance-critical
 * path for a third-party site.
 */
export function isPathDisallowed(robotsTxt: string, path: string): boolean {
  const lines = robotsTxt.split("\n").map((l) => l.trim());
  let inWildcardBlock = false;
  const disallowRules: string[] = [];

  for (const line of lines) {
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey?.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      inWildcardBlock = value === "*";
    } else if (key === "disallow" && inWildcardBlock && value) {
      disallowRules.push(value);
    }
  }

  return disallowRules.some((rule) => path.startsWith(rule));
}

function extractVisibleText(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  const withoutTags = withoutScripts.replace(/<[^>]+>/g, " ");

  return withoutTags
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
