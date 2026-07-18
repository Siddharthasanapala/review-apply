import "server-only";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";

export interface ExtractedDocument {
  text: string;
  lowConfidence: boolean;
  reason?: string;
}

const MIN_CHARS_PER_PAGE = 200;
const MAX_GARBLED_RATIO = 0.15;

/**
 * Detects the two low-confidence signals called out in
 * phase-03-profile-ingestion.md: very short text relative to page count
 * (common with image-heavy/columned designed resumes where extraction
 * misses most content), and a high ratio of non-printable/control
 * characters (garbled extraction from unusual encodings or scanned PDFs
 * without embedded text). Either signal means the caller should offer the
 * user a manual-paste fallback rather than silently proceeding.
 */
function assessConfidence(text: string, pageCount: number): { lowConfidence: boolean; reason?: string } {
  const trimmed = text.trim();

  if (pageCount > 0 && trimmed.length < pageCount * MIN_CHARS_PER_PAGE) {
    return {
      lowConfidence: true,
      reason: `Only ${trimmed.length} characters extracted across ${pageCount} page(s) — likely a scanned or image-heavy document.`,
    };
  }

  if (trimmed.length === 0) {
    return { lowConfidence: true, reason: "No text could be extracted." };
  }

  const garbledChars = trimmed.match(/[^\x20-\x7E\s -￿]/g)?.length ?? 0;
  const garbledRatio = garbledChars / trimmed.length;
  if (garbledRatio > MAX_GARBLED_RATIO) {
    return {
      lowConfidence: true,
      reason: "Extracted text contains a high ratio of unreadable characters.",
    };
  }

  return { lowConfidence: false };
}

export async function extractFromPdf(buffer: ArrayBuffer): Promise<ExtractedDocument> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text, totalPages } = await extractPdfText(pdf, { mergePages: true });
  const { lowConfidence, reason } = assessConfidence(text, totalPages);
  return { text: text.trim(), lowConfidence, reason };
}

export async function extractFromDocx(buffer: ArrayBuffer): Promise<ExtractedDocument> {
  const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
  const text = result.value.trim();
  // DOCX has no page count signal available without rendering; fall back
  // to a flat minimum-length check instead of the per-page heuristic.
  const { lowConfidence, reason } = assessConfidence(text, text.length > 0 ? 1 : 0);
  return { text, lowConfidence, reason };
}

export async function extractFromFile(
  buffer: ArrayBuffer,
  mimeType: string,
): Promise<ExtractedDocument> {
  if (mimeType === "application/pdf") {
    return extractFromPdf(buffer);
  }
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return extractFromDocx(buffer);
  }
  throw new Error(`Unsupported file type: ${mimeType}`);
}
