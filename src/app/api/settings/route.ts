import { z } from "zod";
import { auth } from "@/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  matchThreshold: z.number().min(0).max(100).optional(),
  notificationsEnabled: z.boolean().optional(),
  timezone: z.string().min(1).optional(),
});

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
    .select("id, settings")
    .eq("email", session.user.email)
    .single();
  if (!userRow) {
    return Response.json({ error: "User not found" }, { status: 500 });
  }

  const currentSettings = (userRow.settings as Record<string, unknown> | null) ?? {};
  const { error } = await supabase
    .from("users")
    .update({ settings: { ...currentSettings, ...parsed.data } })
    .eq("id", userRow.id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
