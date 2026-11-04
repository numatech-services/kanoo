import { Types } from "mongoose";
import { ActivityItemModel } from "@/models/ActivityItem";
import { PurchasePriceLogModel } from "@/models/PurchasePriceLog";
import { CommandeModel } from "@/models/Commande";
import { BusinessRuleError } from "@/lib/errors";
import { linkInvoiceRef } from "@/lib/restaurant-payables";
import type { TokenPayload } from "@/lib/auth";

type Id = Types.ObjectId;
const DAY = 86_400_000;

/**
 * Historique et comparaison des prix d'achat d'un restaurant, par article, sur
 * 90 jours : dernier prix, moyenne pondérée, plus bas, plus haut, évolution
 * par rapport à l'achat précédent, et par fournisseur (le moins cher en moyenne
 * en tête).
 */
export async function priceHistory(tenantId: string, deskId: string, now = new Date()) {
  const since = new Date(now.getTime() - 90 * DAY);
  const [logs, items] = await Promise.all([
    PurchasePriceLogModel.find({ tenantId, deskId, unitCost: { $gt: 0 }, date: { $gte: since } }).sort({ date: -1 })
      .select("itemId supplierId supplierName unitCost quantity date reference source").lean<Array<{ itemId: Id; supplierId?: Id; supplierName?: string; unitCost: number; quantity: number; date: Date; reference?: string; source: string }>>(),
    ActivityItemModel.find({ tenantId, deskId }).select("name unit").lean<Array<{ _id: Id; name: string; unit: string }>>(),
  ]);
  const names = new Map(items.map(i => [String(i._id), i]));
  const byItem = new Map<string, typeof logs>();
  for (const l of logs) { const k = String(l.itemId); byItem.set(k, [...(byItem.get(k) ?? []), l]); }
  return [...byItem].map(([id, ls]) => {
    const qty = ls.reduce((t, l) => t + l.quantity, 0);
    const avg = qty ? ls.reduce((t, l) => t + l.unitCost * l.quantity, 0) / qty : 0;
    const sup = new Map<string, typeof ls>();
    for (const l of ls) { const k = l.supplierName || "Sans fournisseur"; sup.set(k, [...(sup.get(k) ?? []), l]); }
    const suppliers = [...sup].map(([name, xs]) => {
      const q = xs.reduce((t, l) => t + l.quantity, 0);
      return { name, avg: Math.round((xs.reduce((t, l) => t + l.unitCost * l.quantity, 0) / (q || 1)) * 100) / 100, last: xs[0].unitCost, lastDate: xs[0].date, purchases: xs.length };
    }).sort((a, b) => a.avg - b.avg);
    const last = ls[0], prev = ls[1];
    return {
      itemId: id, name: names.get(id)?.name ?? "—", unit: names.get(id)?.unit ?? "",
      last: { unitCost: last.unitCost, date: last.date, supplier: last.supplierName ?? null },
      avg: Math.round(avg * 100) / 100, min: Math.min(...ls.map(l => l.unitCost)), max: Math.max(...ls.map(l => l.unitCost)), purchases: ls.length,
      changePct: prev && prev.unitCost > 0 ? Math.round(((last.unitCost - prev.unitCost) / prev.unitCost) * 1000) / 10 : null,
      suppliers, best: suppliers.length > 1 ? suppliers[0].name : null,
      // Ce qu'aurait coûté l'achat chez le moins cher (même quantité), sur la période.
      savings: suppliers.length > 1 ? Math.round(ls.reduce((t, l) => t + Math.max(0, l.unitCost - suppliers[0].avg) * l.quantity, 0)) : 0,
    };
  }).sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0) || a.name.localeCompare(b.name));
}

/**
 * Pour le comptable : réceptions en réserve non payées en caisse et sans
 * facture rapprochée ; commandes du restaurant reçues sans facture d'achat.
 */
export async function toInvoice(tenantId: string, deskId: string) {
  const [receptions, orders] = await Promise.all([
    PurchasePriceLogModel.find({ tenantId, deskId, source: "reception", paidFromCash: false, invoiceRef: { $exists: false } }).sort({ date: -1 }).limit(300)
      .populate("itemId", "name unit").lean<Array<{ _id: Id; itemId?: { name: string; unit: string }; supplierName?: string; unitCost: number; quantity: number; date: Date; reference?: string }>>(),
    CommandeModel.find({ tenantId, sourceDeskId: deskId, status: { $in: ["partially_received", "received"] }, purchaseId: { $exists: false } }).select("number totalTTC status orderDate supplierId").populate("supplierId", "name")
      .lean<Array<{ _id: Id; number: string; totalTTC?: number; status: string; orderDate: Date; supplierId?: { name?: string } }>>(),
  ]);
  return {
    receptions: receptions.map(r => ({ _id: String(r._id), item: r.itemId?.name ?? "—", unit: r.itemId?.unit ?? "", supplier: r.supplierName ?? null, quantity: r.quantity, unitCost: r.unitCost, amount: Math.round(r.unitCost * r.quantity), date: r.date, reference: r.reference ?? null })),
    orders: orders.map(o => ({ _id: String(o._id), number: o.number, supplier: o.supplierId?.name ?? null, totalTTC: o.totalTTC ?? 0, status: o.status, date: o.orderDate })),
  };
}

/** Rapproche des réceptions d'une facture du fournisseur (son numéro). */
export async function markInvoiced(auth: TokenPayload, deskId: string, ids: string[], invoiceRef: string) {
  const ref = String(invoiceRef || "").trim().slice(0, 60);
  if (!ref) throw new BusinessRuleError("Numéro de facture du fournisseur obligatoire.");
  const linked = await PurchasePriceLogModel.find({ _id: { $in: ids }, tenantId: auth.tenantId, deskId, invoiceRef: { $exists: false }, purchaseId: { $exists: true } }).select("purchaseId").lean<Array<{ purchaseId: Id }>>();
  const r = await PurchasePriceLogModel.updateMany({ _id: { $in: ids }, tenantId: auth.tenantId, deskId, invoiceRef: { $exists: false } }, { $set: { invoiceRef: ref, invoicedAt: new Date(), invoicedBy: auth.userId } });
  await linkInvoiceRef(auth.tenantId, linked.map(l => l.purchaseId), ref);
  return { matched: r.modifiedCount };
}
