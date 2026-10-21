import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { computeForecast } from "@/lib/treasury-forecast";

export const dynamic = "force-dynamic";

/** GET /api/treasury-accounts/forecast?weeks=13 — prévision par semaine (lib/treasury-forecast.ts). */
export const GET = withAuth("treasuryAccounts", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const weeks = Math.min(52, Math.max(4, Number(new URL(req.url).searchParams.get("weeks")) || 13));
  return ok(await computeForecast(auth.tenantId, weeks));
});
