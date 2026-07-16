import "server-only";
import { env } from "@/lib/env";

/**
 * Every cron-triggered route (/api/ingest, /api/match, /api/draft,
 * /api/notify) must call this first, before any other work. Without it,
 * anyone who finds the route URL could trigger paid Gemini/job-source API
 * calls at will. See ARCHITECTURE.md §7.
 */
export function verifyCronSecret(request: Request): Response | null {
  const authHeader = request.headers.get("authorization");
  const expected = `Bearer ${env.CRON_SECRET}`;

  if (authHeader !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
