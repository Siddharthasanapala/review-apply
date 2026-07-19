import { auth } from "@/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request, ctx: RouteContext<"/api/matches/[matchId]/dismiss">) {
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
    .select("id, user_id, status")
    .eq("id", matchId)
    .single();

  if (!match || match.user_id !== userRow.id) {
    return Response.json({ error: "Match not found" }, { status: 404 });
  }
  if (match.status === "applied") {
    return Response.json({ error: "Already applied — can't dismiss" }, { status: 400 });
  }

  const { error } = await supabase.from("job_matches").update({ status: "dismissed" }).eq("id", matchId);
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
