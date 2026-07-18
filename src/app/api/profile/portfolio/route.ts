import { z } from "zod";
import { auth } from "@/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { fetchPortfolioText } from "@/lib/documents/portfolioFetch";
import { savePortfolioDocument } from "@/lib/profile/profileDocuments";

const bodySchema = z.object({
  url: z.string().url(),
  // Manual-summary fallback (phase-03-profile-ingestion.md JS-rendered
  // SPA edge case): if set, skip fetching entirely and use this text.
  manualText: z.string().optional(),
});

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
  const { data: userRow } = await supabase
    .from("users")
    .select("id")
    .eq("email", session.user.email)
    .single();
  if (!userRow) {
    return Response.json({ error: "User not found" }, { status: 500 });
  }

  let portfolioText: string;

  if (parsed.data.manualText && parsed.data.manualText.trim().length > 0) {
    portfolioText = parsed.data.manualText.trim();
  } else {
    const fetched = await fetchPortfolioText(parsed.data.url);
    if (!fetched.ok) {
      return Response.json({ error: fetched.error }, { status: 422 });
    }

    if (fetched.lowConfidence) {
      // Let the client offer a manual-summary fallback instead of silently
      // storing near-empty text, then resubmit with `manualText` set.
      return Response.json(
        { lowConfidence: true, reason: fetched.reason, extractedText: fetched.text },
        { status: 200 },
      );
    }

    portfolioText = fetched.text;
  }

  const result = await savePortfolioDocument(
    supabase,
    userRow.id as string,
    portfolioText,
    parsed.data.url,
  );

  if (!result.ok) {
    return Response.json({ error: result.extractionError ?? "Failed to save portfolio" }, { status: 500 });
  }

  return Response.json({
    documentId: result.documentId,
    extractionError: result.extractionError,
    embeddingError: result.embeddingError,
  });
}
