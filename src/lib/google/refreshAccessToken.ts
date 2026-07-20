import "server-only";
import { env } from "@/lib/env";
import { fetchWithRetry } from "@/lib/http/fetchWithRetry";

export type RefreshAccessTokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; error: string; invalidGrant: boolean };

/**
 * Exchanges a stored Gmail refresh token for a short-lived access token.
 * `invalidGrant` distinguishes "the refresh token itself is dead" (user
 * revoked access, or it expired) from a transient failure — only the
 * former should flip notifications_paused and ask the user to reconnect.
 */
export async function refreshGoogleAccessToken(refreshToken: string): Promise<RefreshAccessTokenResult> {
  try {
    const res = await fetchWithRetry("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });

    const body = await res.json().catch(() => null);

    if (!res.ok) {
      const error = (body?.error as string | undefined) ?? `HTTP ${res.status}`;
      return { ok: false, error, invalidGrant: error === "invalid_grant" };
    }

    const accessToken = body?.access_token as string | undefined;
    if (!accessToken) {
      return { ok: false, error: "No access_token in response", invalidGrant: false };
    }

    return { ok: true, accessToken };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Token refresh failed",
      invalidGrant: false,
    };
  }
}
