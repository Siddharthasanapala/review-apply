import { auth } from "@/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { extractFromFile } from "@/lib/documents/extractText";
import { saveResumeDocument } from "@/lib/profile/profileDocuments";

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const MAX_SIZE_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return Response.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  // Manual-paste fallback (phase-03-profile-ingestion.md low-confidence
  // extraction edge case): the client can resubmit with text the user
  // fixed themselves, skipping extraction entirely. A file is optional
  // here — the user may be pasting a summary with no file at all.
  const manualText = formData.get("manualText");

  const supabase = getSupabaseServerClient();

  const { data: userRow } = await supabase
    .from("users")
    .select("id")
    .eq("email", session.user.email)
    .single();
  if (!userRow) {
    return Response.json({ error: "User not found" }, { status: 500 });
  }

  let storagePath: string | null = null;
  let resumeText: string;

  if (typeof manualText === "string" && manualText.trim().length > 0) {
    resumeText = manualText.trim();

    if (file instanceof File) {
      if (!ALLOWED_TYPES.has(file.type)) {
        return Response.json({ error: "Only PDF or DOCX files are supported" }, { status: 400 });
      }
      const buffer = await file.arrayBuffer();
      storagePath = `${userRow.id}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("resumes")
        .upload(storagePath, buffer, { contentType: file.type });
      if (uploadError) {
        return Response.json({ error: `Storage upload failed: ${uploadError.message}` }, { status: 500 });
      }
    }
  } else {
    if (!file || !(file instanceof File)) {
      return Response.json({ error: "No file provided" }, { status: 400 });
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return Response.json({ error: "Only PDF or DOCX files are supported" }, { status: 400 });
    }
    if (file.size > MAX_SIZE_BYTES) {
      return Response.json({ error: "File too large (max 10MB)" }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();

    // Upload the pristine buffer to storage BEFORE running it through PDF
    // extraction. pdf.js can transfer/detach the underlying ArrayBuffer as
    // part of loading the document (confirmed via testing: after
    // extraction, the same buffer uploaded 0 bytes) — uploading first
    // avoids depending on the buffer still being intact afterward.
    storagePath = `${userRow.id}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from("resumes")
      .upload(storagePath, buffer, { contentType: file.type });
    if (uploadError) {
      return Response.json({ error: `Storage upload failed: ${uploadError.message}` }, { status: 500 });
    }

    let extracted;
    try {
      extracted = await extractFromFile(buffer, file.type);
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Failed to extract text from file" },
        { status: 422 },
      );
    }

    if (extracted.lowConfidence) {
      // Don't save yet — let the client offer a manual-paste fallback
      // pre-filled with this text, then resubmit with `manualText` set.
      // The file is already uploaded to storage at this point, which is
      // fine — a later resubmit with manualText will just skip re-upload.
      return Response.json(
        { lowConfidence: true, reason: extracted.reason, extractedText: extracted.text },
        { status: 200 },
      );
    }

    resumeText = extracted.text;
  }

  const result = await saveResumeDocument(supabase, userRow.id as string, resumeText, storagePath);

  if (!result.ok) {
    return Response.json({ error: result.extractionError ?? "Failed to save resume" }, { status: 500 });
  }

  return Response.json({
    documentId: result.documentId,
    extractionError: result.extractionError,
    embeddingError: result.embeddingError,
  });
}
