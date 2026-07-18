import { z } from "zod";
import { auth } from "@/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { updateEffectiveSkills } from "@/lib/profile/profileDocuments";

const bodySchema = z.object({ skills: z.array(z.string()) });

export async function PATCH(request: Request) {
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
  const { data: userRow } = await supabase
    .from("users")
    .select("id")
    .eq("email", session.user.email)
    .single();
  if (!userRow) {
    return Response.json({ error: "User not found" }, { status: 500 });
  }

  const result = await updateEffectiveSkills(supabase, userRow.id as string, parsed.data.skills);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  return Response.json({ ok: true });
}
