import "server-only";
import { env } from "@/lib/env";
import { auth } from "@/auth";

/**
 * The four pipeline routes (/api/ingest, /api/match, /api/draft,
 * /api/notify) are called two ways: the scheduled GitHub Actions workflow
 * (CRON_SECRET bearer token, no session) and the Settings "Run now" button
 * (a logged-in user's session, no CRON_SECRET — phase-07 task 4: "session
 * auth is sufficient since it's a logged-in user action, not an external
 * caller"). Accept either.
 */
export async function verifyCronOrSession(request: Request): Promise<Response | null> {
  const authHeader = request.headers.get("authorization");
  if (authHeader === `Bearer ${env.CRON_SECRET}`) {
    return null;
  }

  const session = await auth();
  if (session?.user?.email && (!env.ALLOWED_USER_EMAIL || session.user.email === env.ALLOWED_USER_EMAIL)) {
    return null;
  }

  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
