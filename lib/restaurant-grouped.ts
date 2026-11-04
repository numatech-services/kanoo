import { ActivityDeskModel } from "@/models/ActivityDesk";
import { DeskForecastEventModel, type IDeskForecastEvent } from "@/models/DeskForecastEvent";
import { Types } from "mongoose";
import { BusinessRuleError } from "@/lib/errors";
import { reorderPlan } from "@/lib/spot-server";
import { createReorderOrders } from "@/lib/comptoir-reorder";
import type { TokenPayload } from "@/lib/auth";

type Id = Types.ObjectId;

/**
 * Besoins de tous les sites, consolidés par fournisseur : quantité par site,
 * total arrondi au carton, et transfert proposé avant achat quand un autre site
 * a du stock qu'il ne consommera pas d'ici sa prochaine commande.
 */
export async function groupedPlan(tenantId: string, deskIds: string[]) {
  const desks = await ActivityDeskModel.find({ tenantId, _id: { $in: deskIds }, archived: { $ne: true } }).select("name").sort({ name: 1 }).lean<Array<{ _id: Id; name: string }>>();
  const plans = await Promise.all(desks.map(async d => ({ d, plan: await reorderPlan(tenantId, String(d._id)) })));
  const key = (l: { productId: string | null; name: string }) => l.productId ?? `n:${l.name.toLowerCase()}`;
  const rows = new Map<string, { key: string; name: string; unit: string; packSize: number | null; supplier: { _id: string; name: string } | null; unitValue: number; sites: Array<{ deskId: string; name: string; itemId: string; quantity: number }>; total: number; rawTotal: number; centralTotal: number | null; transfers: Array<{ from: string; to: string; quantity: number }> }>();
  for (const { d, plan } of plans) for (const l of plan.toOrder) {
    const r = rows.get(key(l)) ?? { key: key(l), name: l.name, unit: l.unit, packSize: (l as { packSize?: number }).packSize ?? null, supplier: l.supplier, unitValue: l.quantity ? l.estimatedCost / l.quantity : 0, sites: [], total: 0, rawTotal: 0, centralTotal: null, transfers: [] };
    r.sites.push({ deskId: String(d._id), name: d.name, itemId: l.itemId, quantity: l.quantity });
    r.total += l.quantity; r.rawTotal += (l as { rawQuantity?: number }).rawQuantity ?? l.quantity;
    rows.set(key(l), r);
  }
  for (const r of rows.values()) {
    // Stock disponible ailleurs : un site sans besoin, qui en garde au moins deux fois sa couverture.
    for (const { d, plan } of plans) {
      if (r.sites.some(s => s.deskId === String(d._id))) continue;
      const other = plan.lines.find(l => key(l) === r.key);
      if (!other || !(other.reserve > 0) || (other.daysLeft !== null && other.daysLeft !== undefined && other.daysLeft < plan.coverDays * 2)) continue;
      const need = r.sites[0];
      const give = Math.min(need.quantity, Math.floor(other.reserve / 2));
      if (give > 0) r.transfers.push({ from: d.name, to: need.name, quantity: give });
    }
    // Les bons partent par site, donc en cartons entiers par site : le total est ce qui sera commandé.
    // Une livraison centrale, puis des transferts, demanderait moins de cartons : on le dit.
    const central = r.packSize ? Math.ceil(r.rawTotal / r.packSize) * r.packSize : r.total;
    r.centralTotal = central < r.total ? central : null;
  }
  const bySupplier = new Map<string, { supplier: string; supplierId: string | null; lines: Array<(typeof rows extends Map<string, infer V> ? V : never)>; value: number }>();
  for (const r of rows.values()) {
    const k = r.supplier?._id ?? "none";
    const g = bySupplier.get(k) ?? { supplier: r.supplier?.name ?? "Sans fournisseur habituel", supplierId: r.supplier?._id ?? null, lines: [], value: 0 };
    g.lines.push(r); g.value += Math.round(r.total * r.unitValue);
    bySupplier.set(k, g);
  }
  return { sites: desks.map(d => d.name), suppliers: [...bySupplier.values()].sort((a, b) => b.value - a.value), value: [...bySupplier.values()].reduce((t, g) => t + g.value, 0) };
}

/** Bons de commande brouillon d'une commande groupée : un par site et par fournisseur, livraison directe aux sites. */
export async function createGroupedOrders(auth: TokenPayload, lines: Array<{ deskId: string; itemId: string; quantity: number }>) {
  const bySite = new Map<string, Array<{ itemId: string; quantity: number }>>();
  for (const l of lines) if (Number(l.quantity) > 0) bySite.set(l.deskId, [...(bySite.get(l.deskId) ?? []), { itemId: l.itemId, quantity: Number(l.quantity) }]);
  if (!bySite.size) throw new BusinessRuleError("Aucun besoin à commander.");
  let orders = 0, noSupplier = 0, shopping = 0;
  for (const [deskId, wanted] of bySite) {
    const r = await createReorderOrders(auth, deskId, wanted, { note: "Commande groupée" });
    if ("error" in r) throw new BusinessRuleError(String(r.error));
    orders += r.orders.length; noSupplier += r.noSupplier.length; shopping += r.shopping.length;
  }
  return { orders, noSupplier, shopping };
}

export async function saveForecastEvent(auth: TokenPayload, e: { deskIds?: string[]; from: string; to: string; label: string; factor: number; note?: string }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.from) || !/^\d{4}-\d{2}-\d{2}$/.test(e.to) || e.to < e.from) throw new BusinessRuleError("Période invalide.");
  if (!String(e.label ?? "").trim()) throw new BusinessRuleError("Nom de l'événement obligatoire.");
  const factor = Number(e.factor);
  if (!(factor >= 0 && factor <= 10)) throw new BusinessRuleError("Coefficient invalide (0 à 10).");
  return DeskForecastEventModel.create({ tenantId: auth.tenantId, deskIds: e.deskIds ?? [], from: e.from, to: e.to, label: e.label.trim().slice(0, 120), factor, ...(e.note ? { note: e.note.slice(0, 300) } : {}), createdBy: auth.userId });
}

export const listForecastEvents = (tenantId: string, fromDay: string, deskIds: unknown[] | null) =>
  DeskForecastEventModel.find({ tenantId, to: { $gte: fromDay }, ...(deskIds ? { $or: [{ deskIds: { $size: 0 } }, { deskIds: { $in: deskIds } }] } : {}) }).sort({ from: 1 }).limit(100).lean<IDeskForecastEvent[]>();
