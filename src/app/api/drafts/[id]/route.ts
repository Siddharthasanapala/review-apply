import { z } from "zod";
import { auth } from "@/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const screeningAnswerSchema = z.object({
  question: z.string(),
  answer: z.string(),
  isPlaceholder: z.boolean(),
  placeholderReason: z.string().optional(),
});

const bodySchema = z.object({
  coverLetterText: z.string().optional(),
  screeningAnswers: z.array(screeningAnswerSchema).optional(),
});

// User-driven edits to a draft (phase-06-review-submit-ui.md: cover letter
// and screening answers are "pre-filled but fully editable"). The redline
// resume view itself isn't editable here — the tailored text is a Gemini
// output the user reviews, not a form field.
export async function PATCH(request: Request, ctx: RouteContext<"/api/drafts/[id]">) {
  const session = await auth();
  if (!session?.user?.email) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;

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

  const { data: draft } = await supabase
    .from("application_drafts")
    .select("id, job_match_id, status")
    .eq("id", id)
    .single();

  if (!draft) {
    return Response.json({ error: "Draft not found" }, { status: 404 });
  }

  const { data: match } = await supabase
    .from("job_matches")
    .select("id, user_id, status")
    .eq("id", draft.job_match_id)
    .single();

  if (!match || match.user_id !== userRow.id) {
    return Response.json({ error: "Draft not found" }, { status: 404 });
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.coverLetterText !== undefined) update.cover_letter_text = parsed.data.coverLetterText;
  if (parsed.data.screeningAnswers !== undefined) update.screening_answers = parsed.data.screeningAnswers;
  // Leave an already-applied draft's status alone — editing after the
  // fact is just a correction, not a step backward in the pipeline.
  if (draft.status !== "applied") update.status = "edited";

  const { error } = await supabase.from("application_drafts").update(update).eq("id", id);
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Bump the match into "reviewed" too, if it hasn't moved past that yet —
  // editing a draft is unambiguous evidence the user has reviewed it.
  if (match.status === "drafted" || match.status === "new") {
    await supabase.from("job_matches").update({ status: "reviewed" }).eq("id", match.id);
  }

  return Response.json({ ok: true });
}
