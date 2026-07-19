import { auth } from "@/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";

// "Mark as Applied" — purely the user's own tracking action after they've
// manually submitted on the company's site (CONSTITUTION.md §1: the app
// never submits anything itself). Available whether or not a draft was
// ever generated, since the user may apply directly from a low-score job
// they never bothered drafting.
export async function POST(request: Request, ctx: RouteContext<"/api/matches/[matchId]/apply">) {
  const session = await auth();
  if (!session?.user?.email) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { matchId } = await ctx.params;

  const supabase = getSupabaseServerClient();
  const { data: userRow } = await supabase.from("users").select("id").eq("email", session.user.email).single();
  if (!userRow) {
    return Response.json({ error: "User not found" }, { status: 500 });
  }

  const { data: match } = await supabase
    .from("job_matches")
    .select("id, user_id")
    .eq("id", matchId)
    .single();

  if (!match || match.user_id !== userRow.id) {
    return Response.json({ error: "Match not found" }, { status: 404 });
  }

  const appliedAt = new Date().toISOString();

  const { error } = await supabase
    .from("job_matches")
    .update({ status: "applied", applied_at: appliedAt })
    .eq("id", matchId);
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  await supabase
    .from("application_drafts")
    .update({ status: "applied", applied_at: appliedAt })
    .eq("job_match_id", matchId);

  return Response.json({ ok: true });
}
