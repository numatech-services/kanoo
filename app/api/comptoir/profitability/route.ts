import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, forbidden, tenantFilter } from "@/lib/api-helpers";
import { isId, ownDesk, canSeeDeskCosts } from "@/lib/comptoir";
import { ActivityItemModel } from "@/models/ActivityItem";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { syncLinkedItems } from "@/lib/comptoir-stock";
import { productSales } from "@/lib/comptoir-session";
import { itemEconomics, stockOutlook, THIN_MARKUP } from "@/lib/comptoir-economics";
import { localDay } from "@/lib/comptoir-sale";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET ?deskId=&from=&to= — rentabilité de chaque article du comptoir :
 *  - prévue : coût unitaire (tiré du paquet), prix, marge unitaire, marge par
 *    paquet, prix plancher et prix conseillé ;
 *  - attendue sur le stock : chiffre d'affaires et marge si tout est vendu ;
 *  - réalisée sur la période : quantités, chiffre d'affaires, marge, rang.
 */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const deskId = url.searchParams.get("deskId");
  if (!isId(deskId)) return badRequest("Comptoir invalide");
  if (!(await ownDesk(auth, deskId))) return notFound("Comptoir introuvable");
  if (!canSeeDeskCosts(auth)) return forbidden("Rentabilité réservée au chef du comptoir, au gérant et à la comptabilité.");
  const now = new Date();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("from") ?? "") ? url.searchParams.get("from")! : localDay(new Date(now.getFullYear(), now.getMonth(), 1));
  const to = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("to") ?? "") ? url.searchParams.get("to")! : localDay(now);

  await syncLinkedItems(auth.tenantId, deskId);
  const [desk, items, sold] = await Promise.all([
    ActivityDeskModel.findOne({ _id: deskId, ...tenantFilter(auth) }).select("vatRate targetMarkup").lean<{ vatRate?: number; targetMarkup?: number } | null>(),
    ActivityItemModel.find({ ...tenantFilter(auth), deskId: new Types.ObjectId(deskId), archived: { $ne: true } }).sort({ name: 1 })
      .lean<Array<{ _id: Types.ObjectId; name: string; unit: string; category?: string; quantity: number; unitCost: number; salePrice?: number; threshold?: number; productId?: unknown; pack?: { label?: string; size?: number; cost?: number } }>>(),
    productSales(auth.tenantId, deskId, from, to),
  ]);
  const target = desk?.targetMarkup ?? 0.3;
  const soldBy = new Map(sold.map(s => [s.itemId, s]));
  const rank = new Map(sold.map((s, i) => [s.itemId, i + 1]));
  const rows = items.map(it => {
    // Article du catalogue : son coût est le coût moyen réel (CMUP) ; le
    // paquet ne sert qu'à compter. Article propre : le prix du paquet fait foi.
    const pack = it.productId && it.unitCost > 0 && it.pack ? { label: it.pack.label, size: it.pack.size } : it.pack;
    const e = itemEconomics({ unitCost: it.unitCost, pack, salePrice: it.salePrice, vatRate: desk?.vatRate, targetMarkup: target });
    const s = soldBy.get(String(it._id));
    return {
      _id: String(it._id), name: it.name, unit: it.unit, category: it.category ?? "", quantity: it.quantity, salePrice: it.salePrice ?? null,
      pack: it.pack ?? null, linked: !!it.productId, threshold: it.threshold ?? null,
      economics: e, outlook: stockOutlook(it.quantity, e),
      sold: s ? { quantity: s.quantity, revenueTTC: s.revenueTTC, margin: s.margin, tickets: s.tickets, rank: rank.get(String(it._id)) } : null,
    };
  });
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((t, r) => t + f(r), 0);
  const categories = [...new Set(rows.map(r => r.category || "Sans famille"))].map(c => {
    const rs = rows.filter(r => (r.category || "Sans famille") === c);
    return { category: c, revenueTTC: rs.reduce((t, r) => t + (r.sold?.revenueTTC ?? 0), 0), margin: rs.reduce((t, r) => t + (r.sold?.margin ?? 0), 0), quantity: rs.reduce((t, r) => t + (r.sold?.quantity ?? 0), 0) };
  }).sort((a, b) => b.revenueTTC - a.revenueTTC);
  return ok({
    from, to, targetMarkup: target, thinMarkup: THIN_MARKUP, vatRate: desk?.vatRate ?? 0,
    items: rows,
    totals: {
      stockValue: sum(r => r.outlook.stockValue), expectedRevenue: sum(r => r.outlook.expectedRevenue), expectedMargin: sum(r => r.outlook.expectedMargin ?? 0),
      soldRevenue: sold.reduce((t, s) => t + s.revenueTTC, 0), soldMargin: sold.reduce((t, s) => t + s.margin, 0),
      losses: rows.filter(r => r.economics.status === "loss").length, thin: rows.filter(r => r.economics.status === "thin").length,
      unpriced: rows.filter(r => r.economics.status === "unknown").length,
    },
    categories,
    best: sold.slice(0, 5).map(s => ({ itemId: s.itemId, label: s.label, revenueTTC: s.revenueTTC, quantity: s.quantity, margin: s.margin })),
  });
});
