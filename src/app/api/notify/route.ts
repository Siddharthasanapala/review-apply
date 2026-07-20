import { verifyCronOrSession } from "@/lib/cron/verifyCronOrSession";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { releasePipelineLock } from "@/lib/cron/pipelineLock";
import { refreshGoogleAccessToken } from "@/lib/google/refreshAccessToken";
import { sendGmailMessage } from "@/lib/gmail/sendGmailMessage";
import { composeDigestEmail, type DigestMatchItem } from "@/lib/notify/composeDigest";

export const maxDuration = 60;

// Last step of the pipeline (ingest -> match -> draft -> notify) — always
// releases the pipeline_runs lock before returning, whatever the outcome,
// since reaching this route at all means the sequence completed.
export async function POST(request: Request) {
  const unauthorized = await verifyCronOrSession(request);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseServerClient();

  try {
    const userQuery = supabase
      .from("users")
      .select("id, email, settings, google_refresh_token, notifications_paused, last_notified_at");
    const { data: userRow } = env.ALLOWED_USER_EMAIL
      ? await userQuery.eq("email", env.ALLOWED_USER_EMAIL).single()
      : await userQuery.limit(1).single();

    if (!userRow) {
      await releasePipelineLock(supabase, "completed");
      return Response.json({ error: "No user found" }, { status: 500 });
    }

    const userId = userRow.id as string;
    const settings = (userRow.settings as Record<string, unknown> | null) ?? {};
    const matchThreshold = (settings.matchThreshold as number | undefined) ?? 70;
    const notificationsEnabled = (settings.notificationsEnabled as boolean | undefined) ?? false;

    if (!notificationsEnabled) {
      await releasePipelineLock(supabase, "completed");
      return Response.json({ ranAt: new Date().toISOString(), skipped: "notifications not enabled" });
    }

    const refreshToken = userRow.google_refresh_token as string | null;
    if (!refreshToken) {
      await supabase
        .from("users")
        .update({ notifications_paused: true, notifications_paused_reason: "Gmail not connected" })
        .eq("id", userId);
      await supabase.from("notification_log").insert({
        user_id: userId,
        status: "failed",
        job_match_count: 0,
        error_text: "Gmail not connected",
      });
      await releasePipelineLock(supabase, "completed");
      return Response.json({ ranAt: new Date().toISOString(), error: "Gmail not connected" });
    }

    const since = (userRow.last_notified_at as string | null) ?? new Date(0).toISOString();

    const { data: matches } = await supabase
      .from("job_matches")
      .select("id, job_id, score, rationale_text")
      .eq("user_id", userId)
      .gte("score", matchThreshold)
      .gt("created_at", since);

    if (!matches || matches.length === 0) {
      await supabase
        .from("notification_log")
        .insert({ user_id: userId, status: "skipped_no_matches", job_match_count: 0 });
      // Safe to advance the "since" pointer — there was genuinely nothing
      // to report for this window, so nothing gets missed by moving it
      // forward (contrast with the send-failure path below, which does NOT
      // advance it).
      await supabase.from("users").update({ last_notified_at: new Date().toISOString() }).eq("id", userId);
      await releasePipelineLock(supabase, "completed");
      return Response.json({ ranAt: new Date().toISOString(), summary: { matched: 0 } });
    }

    const jobIds = matches.map((m) => m.job_id as string);
    const matchIds = matches.map((m) => m.id as string);

    const { data: jobs } = await supabase.from("jobs").select("id, title, company").in("id", jobIds);
    const jobById = new Map((jobs ?? []).map((j) => [j.id as string, j]));

    const { data: drafts } = await supabase
      .from("application_drafts")
      .select("id, job_match_id")
      .in("job_match_id", matchIds);
    const draftIdByMatchId = new Map((drafts ?? []).map((d) => [d.job_match_id as string, d.id as string]));

    const items: DigestMatchItem[] = matches.flatMap((m) => {
      const job = jobById.get(m.job_id as string);
      if (!job) return [];
      const draftId = draftIdByMatchId.get(m.id as string);
      const link = draftId ? `${env.NEXTAUTH_URL}/drafts/${draftId}` : `${env.NEXTAUTH_URL}/dashboard`;
      return [
        {
          title: job.title as string,
          company: job.company as string,
          score: m.score as number,
          rationale: (m.rationale_text as string | null) ?? "",
          link,
        },
      ];
    });

    const email = composeDigestEmail(items, `${env.NEXTAUTH_URL}/dashboard`);

    const tokenResult = await refreshGoogleAccessToken(refreshToken);
    if (!tokenResult.ok) {
      if (tokenResult.invalidGrant) {
        await supabase
          .from("users")
          .update({ notifications_paused: true, notifications_paused_reason: "Gmail access expired — please reconnect." })
          .eq("id", userId);
      }
      await supabase.from("notification_log").insert({
        user_id: userId,
        status: "failed",
        job_match_count: items.length,
        error_text: tokenResult.error,
      });
      await releasePipelineLock(supabase, "completed");
      return Response.json({ ranAt: new Date().toISOString(), error: tokenResult.error });
    }

    const sendResult = await sendGmailMessage(tokenResult.accessToken, {
      to: userRow.email as string,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });

    if (!sendResult.ok) {
      if (sendResult.authFailure) {
        await supabase
          .from("users")
          .update({ notifications_paused: true, notifications_paused_reason: "Gmail access expired — please reconnect." })
          .eq("id", userId);
      }
      await supabase.from("notification_log").insert({
        user_id: userId,
        status: "failed",
        job_match_count: items.length,
        error_text: sendResult.error,
      });
      await releasePipelineLock(supabase, "completed");
      return Response.json({ ranAt: new Date().toISOString(), error: sendResult.error });
    }

    await supabase.from("notification_log").insert({
      user_id: userId,
      status: "sent",
      job_match_count: items.length,
    });
    await supabase
      .from("users")
      .update({
        last_notified_at: new Date().toISOString(),
        notifications_paused: false,
        notifications_paused_reason: null,
      })
      .eq("id", userId);

    await releasePipelineLock(supabase, "completed");
    return Response.json({ ranAt: new Date().toISOString(), summary: { sent: items.length } });
  } catch (err) {
    await releasePipelineLock(supabase, "failed", err instanceof Error ? err.message : "Unknown error");
    return Response.json({ error: "Notify failed" }, { status: 500 });
  }
}
