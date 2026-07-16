import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Single-tenant app: there is exactly one user, and all server-side code
 * is trusted (routes are either session-gated or CRON_SECRET-gated). The
 * service-role key is used directly rather than layering Postgres RLS for
 * a multi-tenant model this app doesn't have.
 */
export function getSupabaseServerClient() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}
