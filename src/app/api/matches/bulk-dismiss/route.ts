import { z } from "zod";
import { auth } from "@/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const bodySchema = z.object({ matchIds: z.array(z.string().uuid()).min(1).max(100) });

// Bulk-dismiss so the review queue doesn't become unmanageable at scale
// (phase-06-review-submit-ui.md edge case). Silently skips any id that
// isn't the caller's own or is already applied, rather than failing the
// whole batch over one bad id.
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { data: userRow } = await supabase.from("users").select("id").eq("email", session.user.email).single();
  if (!userRow) {
    return Response.json({ error: "User not found" }, { status: 500 });
  }

  const { error, count } = await supabase
    .from("job_matches")
    .update({ status: "dismissed" }, { count: "exact" })
    .in("id", parsed.data.matchIds)
    .eq("user_id", userRow.id)
    .neq("status", "applied");

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true, dismissed: count ?? 0 });
}
