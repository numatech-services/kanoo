import { NextRequest, NextResponse } from "next/server";
import { spotContext } from "@/lib/api-v1-middleware";
import { linkCatalogue } from "@/lib/easypay-server";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/spot/catalogue/link — relie les articles d'EasyPay à ceux de
 * Kanoo (par id puis par nom), crée les absents si create_missing. Scope
 * spot:write. Corps : { items: [{ id, name, category?, price?, kanoo_id? }], create_missing? }.
 */
export async function POST(req: NextRequest) {
  const a = await spotContext(req, "spot:write");
  if ("error" in a) return a.error;
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.items) || body.items.length === 0) return NextResponse.json({ error: "items : liste d'articles attendue." }, { status: 400 });
  if (body.items.length > 500) return NextResponse.json({ error: "500 articles au plus par appel." }, { status: 400 });
  if (!a.ctx.userId) return NextResponse.json({ error: "Clé sans auteur : créez-la depuis le comptoir." }, { status: 403 });
  const links = await linkCatalogue({ tenantId: a.ctx.tenantId, deskId: a.ctx.deskId, userId: a.ctx.userId }, body.items, body.create_missing === true);
  return NextResponse.json({ success: true, data: { links }, api_version: "v1" });
}
