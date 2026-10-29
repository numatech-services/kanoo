import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { keyDates } from "@/lib/key-dates";

export const dynamic = "force-dynamic";

/**
 * GET /api/appels/reminders?days=7&cautionDays=30 — échéances des marchés
 * (dates clés des offres, cautions, jalons de facturation) à partir
 * d'aujourd'hui. Rappels de la semaine (7 j) et onglet Calendrier (90 j).
 */
export const GET = withAuth("appels", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const days = Math.min(366, Math.max(1, Number(url.searchParams.get("days")) || 7));
  const cautionDays = Math.min(366, Math.max(days, Number(url.searchParams.get("cautionDays")) || days));
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const at = (n: number) => { const d = new Date(from); d.setDate(d.getDate() + n); d.setHours(23, 59, 59, 999); return d; };
  return ok(await keyDates(auth, from, at(days), at(cautionDays)));
});
