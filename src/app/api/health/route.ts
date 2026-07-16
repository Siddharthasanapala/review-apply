import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const appStatus = "ok" as const;
  let dbStatus: "ok" | "error" = "ok";
  let dbError: string | undefined;

  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase
      .from("users")
      .select("id", { count: "exact", head: true });

    if (error) {
      dbStatus = "error";
      dbError = error.message;
    }
  } catch (err) {
    dbStatus = "error";
    dbError = err instanceof Error ? err.message : "Unknown DB error";
  }

  const overallOk = appStatus === "ok" && dbStatus === "ok";

  return Response.json(
    {
      app: appStatus,
      db: dbStatus,
      ...(dbError ? { dbError } : {}),
      timestamp: new Date().toISOString(),
    },
    { status: overallOk ? 200 : 503 },
  );
}
