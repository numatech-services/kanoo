import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, forbidden, tenantFilter } from "@/lib/api-helpers";
import { isId, ownDesk, canSeeDeskCosts } from "@/lib/comptoir";
import { ComptoirSaleModel } from "@/models/ComptoirSale";
import { CashClosingModel } from "@/models/CashClosing";
import { UserModel } from "@/models/User";
import { localDay } from "@/lib/comptoir-sale";
import { cancellationAlert } from "@/lib/spot";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET ?deskId=&from=&to= — par caissier : tickets, chiffre d'affaires,
 * annulations (nombre, montant, taux), remises accordées, écarts des arrêtés
 * qu'il a faits. Réservé au chef du comptoir et à la direction.
 */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const deskId = url.searchParams.get("deskId");
  if (!isId(deskId)) return badRequest("Comptoir invalide");
  if (!(await ownDesk(auth, deskId))) return notFound("Comptoir introuvable");
  if (!canSeeDeskCosts(auth)) return forbidden("Contrôle des caissiers réservé au chef du comptoir et à la direction.");
  const now = new Date();
  const from = url.searchParams.get("from") ?? localDay(new Date(now.getTime() - 6 * 86_400_000));
  const to = url.searchParams.get("to") ?? localDay(now);
  const range = { $gte: new Date(`${from}T00:00:00.000`), $lte: new Date(`${to}T23:59:59.999`) };
  const did = new Types.ObjectId(deskId);
  const [sales, gaps] = await Promise.all([
    ComptoirSaleModel.aggregate<{ _id: Types.ObjectId; tickets: number; revenue: number; cancelled: number; cancelledAmount: number; discount: number }>([
      { $match: { ...tenantFilter(auth), deskId: did, date: range } },
      { $project: { cashierId: 1, status: 1, totalTTC: 1,
        discount: { $sum: { $map: { input: "$lines", as: "l", in: { $subtract: [{ $multiply: [{ $ifNull: ["$$l.listPrice", "$$l.unitPriceTTC"] }, "$$l.quantity"] }, "$$l.totalTTC"] } } } } } },
      { $group: { _id: "$cashierId", tickets: { $sum: 1 },
        revenue: { $sum: { $cond: [{ $eq: ["$status", "paid"] }, "$totalTTC", 0] } },
        cancelled: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] } },
        cancelledAmount: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, "$totalTTC", 0] } },
        discount: { $sum: { $cond: [{ $eq: ["$status", "paid"] }, "$discount", 0] } } } },
    ]),
    CashClosingModel.aggregate<{ _id: Types.ObjectId; gap: number; n: number }>([
      { $match: { ...tenantFilter(auth), deskId: did, day: { $gte: from, $lte: to } } },
      { $group: { _id: "$closedBy", gap: { $sum: "$gap" }, n: { $sum: 1 } } },
    ]),
  ]);
  const ids = [...new Set([...sales.map(s => String(s._id)), ...gaps.map(g => String(g._id))])];
  const users = new Map((await UserModel.find({ _id: { $in: ids } }).select("firstName lastName").lean<Array<{ _id: Types.ObjectId; firstName?: string; lastName?: string }>>()).map(u => [String(u._id), `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim()]));
  const items = ids.map(id => {
    const s = sales.find(x => String(x._id) === id), g = gaps.find(x => String(x._id) === id);
    const tickets = s?.tickets ?? 0, cancelled = s?.cancelled ?? 0;
    return {
      userId: id, name: users.get(id) ?? "—", tickets, revenueTTC: s?.revenue ?? 0, averageTicket: tickets - cancelled > 0 ? Math.round((s?.revenue ?? 0) / (tickets - cancelled)) : 0,
      cancelled, cancelledAmount: s?.cancelledAmount ?? 0, cancelRate: tickets ? Math.round((cancelled / tickets) * 1000) / 10 : 0,
      discountGiven: Math.round(s?.discount ?? 0), closings: g?.n ?? 0, cashGap: g?.gap ?? 0,
      alert: cancellationAlert(cancelled, tickets) || (g?.gap ?? 0) < -1000,
    };
  }).sort((a, b) => b.revenueTTC - a.revenueTTC);
  return ok({ from, to, items });
});
