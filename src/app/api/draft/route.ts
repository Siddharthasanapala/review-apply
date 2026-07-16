import { verifyCronSecret } from "@/lib/cron/verifyCronSecret";

// Real drafting logic lands in Phase 5. This stub exists now so the
// CRON_SECRET auth gate is in place from Phase 1, per ARCHITECTURE.md §7.
export async function POST(request: Request) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) return unauthorized;

  return Response.json(
    { error: "Not implemented — drafting lands in Phase 5" },
    { status: 501 },
  );
}
