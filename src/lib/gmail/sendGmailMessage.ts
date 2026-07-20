import "server-only";
import { fetchWithRetry } from "@/lib/http/fetchWithRetry";

export interface DigestEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type SendGmailResult = { ok: true } | { ok: false; error: string; authFailure: boolean };

function toBase64Url(input: string): string {
  return Buffer.from(input, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buildRawMessage(email: DigestEmail): string {
  const boundary = "jobpilot-digest-boundary";
  const message = [
    `To: ${email.to}`,
    `Subject: ${email.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    email.text,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "",
    email.html,
    "",
    `--${boundary}--`,
  ].join("\r\n");

  return toBase64Url(message);
}

/**
 * Sends via the Gmail API's users.messages.send (not SMTP/nodemailer) so
 * this piggybacks on the same Google OAuth client already used for sign-in
 * — no separate SMTP credentials to manage. `authFailure` distinguishes a
 * dead/expired access token from any other failure, so the caller knows
 * whether to surface the "notifications paused, please re-auth" banner.
 */
export async function sendGmailMessage(accessToken: string, email: DigestEmail): Promise<SendGmailResult> {
  try {
    const res = await fetchWithRetry("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: buildRawMessage(email) }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const error = (body?.error?.message as string | undefined) ?? `HTTP ${res.status}`;
      return { ok: false, error, authFailure: res.status === 401 || res.status === 403 };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Gmail send failed",
      authFailure: false,
    };
  }
}
