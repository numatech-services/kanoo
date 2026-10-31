import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { ActivityItemModel } from "@/models/ActivityItem";
import { ActivityCashEntryModel } from "@/models/ActivityCashEntry";
import { TokenPayload } from "@/lib/auth";
import { isId, ownDesk } from "@/lib/comptoir";
import { syncLinkedItems } from "@/lib/comptoir-stock";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { ProductStockModel } from "@/models/ProductStock";
import { canSeeDeskCosts } from "@/lib/comptoir";

export const dynamic = "force-dynamic";

/**
 * Synthèse d'un comptoir : valorisation du stock matière, articles sous le seuil,
 * et solde de caisse (recettes − dépenses). Alimente le tableau de bord du
 * comptoir (The Spot).
 */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const deskId = url.searchParams.get("deskId");
  if (!isId(deskId)) return badRequest("Comptoir invalide");
  if (!(await ownDesk(auth, deskId))) return notFound("Comptoir introuvable");

  await syncLinkedItems(auth.tenantId, deskId);
  const items = await ActivityItemModel.find({ ...tenantFilter(auth), deskId, archived: { $ne: true } })
    .select("name unit quantity unitCost threshold productId").lean<{ name: string; unit: string; quantity: number; unitCost: number; threshold?: number; productId?: unknown }[]>();

  // Valeur du stock : comptoir et réserve du restaurant (stock en gros), au coût.
  const desk = await ActivityDeskModel.findOne({ _id: deskId, ...tenantFilter(auth) }).select("reserveWarehouseId").lean<{ reserveWarehouseId?: unknown } | null>();
  const reserve = desk?.reserveWarehouseId
    ? await ProductStockModel.find({ ...tenantFilter(auth), warehouseId: desk.reserveWarehouseId, productId: { $in: items.map(i => i.productId).filter(Boolean) } }).select("productId qty").lean<Array<{ productId: unknown; qty: number }>>()
    : [];
  const inReserve = new Map(reserve.map(r => [String(r.productId), Math.max(0, r.qty)]));
  const stockValue = items.reduce((s, it) => s + ((it.quantity || 0) + (it.productId ? inReserve.get(String(it.productId)) ?? 0 : 0)) * (it.unitCost || 0), 0);
  const lowStock = items
    .filter(it => it.threshold != null && (it.quantity || 0) <= it.threshold)
    .map(it => ({ name: it.name, unit: it.unit, quantity: it.quantity, threshold: it.threshold }));

  const cash = await ActivityCashEntryModel.aggregate([
    { $match: { tenantId: new Types.ObjectId(String(auth.tenantId)), deskId: new Types.ObjectId(String(deskId)) } },
    { $group: { _id: "$direction", total: { $sum: "$amount" } } },
  ]);
  const cashIn = cash.find(c => c._id === "in")?.total || 0;
  const cashOut = cash.find(c => c._id === "out")?.total || 0;

  return ok({
    itemCount: items.length,
    // Valeur du stock : rôles financiers seulement (null = masquée).
    stockValue: canSeeDeskCosts(auth) ? stockValue : null,
    lowStock,
    cashIn,
    cashOut,
    cashBalance: cashIn - cashOut,
  });
});
