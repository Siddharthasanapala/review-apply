import { z } from "zod";

/**
 * Every env var the app needs at runtime, validated eagerly at import time
 * so a missing/misconfigured value fails loudly at boot instead of
 * surfacing as a confusing runtime error deep in a request handler.
 *
 * Vars only needed by later phases (job source keys, Gmail scope, etc.)
 * are intentionally NOT required here yet — see .env.example for the
 * full eventual list. Add to this schema as each phase starts using one.
 */
const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  NEXTAUTH_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  CRON_SECRET: z.string().min(1),
  // Optional: when set, only this email may sign in (see src/auth.ts). Not
  // required at boot since an unset value just means "no restriction".
  ALLOWED_USER_EMAIL: z.string().email().optional(),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");
    throw new Error(
      `Missing or invalid required environment variables: ${missing}. ` +
        `Check .env.local against .env.example.`,
    );
  }
  return parsed.data;
}

export const env = loadEnv();
