import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { isId, ownDesk, canSeeDeskCosts } from "@/lib/comptoir";
import { DeskPromoModel } from "@/models/DeskPromo";
import { ComptoirSaleModel } from "@/models/ComptoirSale";
import { localDay } from "@/lib/comptoir-sale";
import { logAudit } from "@/lib/audit";
import { promoFields } from "@/lib/desk-promo";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";
/**
 * GET ?deskId=&from=&to= — promotions du comptoir et leur effet sur la
 * période : quantités, chiffre d'affaires, remise accordée, marge.
 */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const deskId = url.searchParams.get("deskId");
  if (!isId(deskId)) return badRequest("Comptoir invalide");
  if (!(await ownDesk(auth, deskId))) return notFound("Comptoir introuvable");
  const now = new Date();
  const from = url.searchParams.get("from") ?? localDay(new Date(now.getFullYear(), now.getMonth(), 1));
  const to = url.searchParams.get("to") ?? localDay(now);
  const [items, effect] = await Promise.all([
    DeskPromoModel.find({ ...tenantFilter(auth), deskId: new Types.ObjectId(deskId) }).sort({ active: -1, createdAt: -1 }).lean(),
    ComptoirSaleModel.aggregate<{ _id: Types.ObjectId; qty: number; ttc: number; discount: number; margin: number; tickets: number }>([
      { $match: { ...tenantFilter(auth), deskId: new Types.ObjectId(deskId), status: "paid", date: { $gte: new Date(`${from}T00:00:00.000`), $lte: new Date(`${to}T23:59:59.999`) } } },
      { $unwind: "$lines" }, { $match: { "lines.promoId": { $exists: true } } },
      { $group: { _id: "$lines.promoId", qty: { $sum: "$lines.quantity" }, ttc: { $sum: "$lines.totalTTC" }, discount: { $sum: { $multiply: [{ $subtract: ["$lines.listPrice", "$lines.unitPriceTTC"] }, "$lines.quantity"] } }, margin: { $sum: { $ifNull: ["$lines.marginHT", 0] } }, tickets: { $sum: 1 } } },
    ]),
  ]);
  const costs = canSeeDeskCosts(auth);
  const eff = new Map(effect.map(e => [String(e._id), { quantity: e.qty, revenueTTC: e.ttc, discount: Math.round(e.discount), tickets: e.tickets, ...(costs ? { margin: Math.round(e.margin) } : {}) }]));
  return ok({ items: (items as Array<{ _id: Types.ObjectId }>).map(p => ({ ...p, effect: eff.get(String(p._id)) ?? null })) });
});

/** POST — nouvelle promotion (happy hour, prix de gros, promo du vendredi…). */
export const POST = withAuth("comptoir", "update", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  if (!(await ownDesk(auth, body.deskId))) return notFound("Comptoir introuvable");
  const f = promoFields(body);
  if (typeof f === "string") return badRequest(f);
  const p = await DeskPromoModel.create({ ...f, tenantId: auth.tenantId, deskId: body.deskId, createdBy: auth.userId });
  await logAudit(auth, "CREATE", "comptoir", { resourceId: String(p._id), metadata: { promo: f.name } });
  return created(p);
});
