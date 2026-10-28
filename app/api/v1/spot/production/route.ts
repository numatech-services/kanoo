import { NextRequest, NextResponse } from "next/server";
import { spotContext } from "@/lib/api-v1-middleware";
import { productionFor } from "@/lib/easypay-server";
import { localDay } from "@/lib/comptoir-sale";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/spot/production?day=AAAA-MM-JJ — quantités à préparer pour un
 * jour (demain par défaut) : prévision d'après l'emploi du temps du campus et
 * pré-commandes. Scope spot:read.
 */
export async function GET(req: NextRequest) {
  const a = await spotContext(req, "spot:read");
  if ("error" in a) return a.error;
  const raw = new URL(req.url).searchParams.get("day");
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const day = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : localDay(tomorrow);
  return NextResponse.json({ success: true, data: await productionFor(a.ctx.tenantId, a.ctx.deskId, day), api_version: "v1" });
}
