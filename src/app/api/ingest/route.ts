import { verifyCronSecret } from "@/lib/cron/verifyCronSecret";

// Real ingestion logic lands in Phase 2. This stub exists now so the
// CRON_SECRET auth gate is in place from Phase 1, per ARCHITECTURE.md §7.
export async function POST(request: Request) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) return unauthorized;

  return Response.json(
    { error: "Not implemented — ingestion lands in Phase 2" },
    { status: 501 },
  );
}
