import { Types } from "mongoose";
import { ClientModel } from "@/models/Client";
import { SupplierModel } from "@/models/Supplier";
import { InvoiceModel } from "@/models/Invoice";
import { escapeRegex } from "@/lib/api-helpers";

/**
 * Recherche texte commune aux listes (factures, devis, encaissements,
 * commandes, livraisons) : numéro ou référence, libellés des lignes, nom ou
 * code du tiers. Les listes ne cherchaient que le numéro, ou rien.
 *
 * Renvoie une condition `$or` à ajouter au filtre, ou null sans recherche.
 */
export async function searchCondition(
  tenantId: string, raw: string | null | undefined,
  opts: { fields: string[]; client?: string; supplier?: string; invoice?: string },
): Promise<Record<string, unknown> | null> {
  const q = escapeRegex(raw?.trim().slice(0, 80) ?? "");
  if (!q) return null;
  const rx = { $regex: q, $options: "i" };
  const tid = new Types.ObjectId(tenantId);
  const or: Array<Record<string, unknown>> = opts.fields.map(f => ({ [f]: rx }));
  const third = { tenantId: tid, $or: [{ name: rx }, { code: rx }] };
  const [clients, suppliers] = await Promise.all([
    opts.client || opts.invoice ? ClientModel.find(third).select("_id").limit(200).lean<Array<{ _id: Types.ObjectId }>>() : [],
    opts.supplier ? SupplierModel.find(third).select("_id").limit(200).lean<Array<{ _id: Types.ObjectId }>>() : [],
  ]);
  if (opts.client && clients.length) or.push({ [opts.client]: { $in: clients.map(c => c._id) } });
  if (opts.supplier && suppliers.length) or.push({ [opts.supplier]: { $in: suppliers.map(s => s._id) } });
  // Encaissements : par numéro de facture ou par client de la facture.
  if (opts.invoice) {
    const invs = await InvoiceModel.find({ tenantId: tid, $or: [{ number: rx }, ...(clients.length ? [{ clientId: { $in: clients.map(c => c._id) } }] : [])] })
      .select("_id").limit(500).lean<Array<{ _id: Types.ObjectId }>>();
    if (invs.length) or.push({ [opts.invoice]: { $in: invs.map(i => i._id) } });
  }
  return { $or: or };
}

/** Ajoute la condition de recherche à un filtre (en conservant un `$or` déjà présent). */
export function withSearch(filter: Record<string, unknown>, cond: Record<string, unknown> | null) {
  if (!cond) return filter;
  if (filter.$or) { filter.$and = [...((filter.$and as unknown[]) ?? []), { $or: filter.$or }, cond]; delete filter.$or; }
  else Object.assign(filter, cond);
  return filter;
}
