import { z } from "zod";
import { auth } from "@/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { upsertManualJob } from "@/lib/jobs/ingestManual";

const manualJobSchema = z.object({
  url: z.string().url(),
  company: z.string().optional(),
  title: z.string().optional(),
  location: z.string().optional(),
  descriptionRaw: z.string().optional(),
});

// Session-auth, not CRON_SECRET — this is a user-facing action, not a
// cron call (ARCHITECTURE.md §4 folder structure note).
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = manualJobSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid input", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const supabase = getSupabaseServerClient();

  const { data: manualSource, error: sourceError } = await supabase
    .from("job_sources")
    .select("id")
    .eq("type", "manual")
    .limit(1)
    .single();

  if (sourceError || !manualSource) {
    return Response.json({ error: "Manual source not configured" }, { status: 500 });
  }

  try {
    const result = await upsertManualJob(supabase, parsed.data, manualSource.id as string);
    return Response.json(result, { status: 201 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to save job" },
      { status: 500 },
    );
  }
}
