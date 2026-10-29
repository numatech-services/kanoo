import { Types } from "mongoose";
import { PurchaseModel } from "@/models/Purchase";
import { SupplierModel } from "@/models/Supplier";
import { agingBucket, type AgingBucket } from "@/lib/automations";
import { TenantModel } from "@/models/Tenant";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { balanceFloor } from "@/lib/accounting-reports";

/** Délai de paiement supposé d'une facture fournisseur sans échéance. */
const DEFAULT_TERM_DAYS = 30;

export const BUCKETS: AgingBucket[] = ["overdue_90", "overdue_60", "overdue_30", "overdue", "due_7", "due_30", "later", "no_date"];

/**
 * Échéancier des factures fournisseurs non soldées (validées ou payées en
 * partie) et balance âgée par fournisseur, à une date.
 */
export async function supplierSchedule(tenantId: string, now = new Date()) {
  const tid = new Types.ObjectId(String(tenantId));
  const purchases = await PurchaseModel.find({ tenantId: tid, status: { $in: ["validated", "partial"] } })
    .select("number date dueDate supplierId payee totalTTC paidAmount kind")
    .lean<Array<{ _id: Types.ObjectId; number: string; date: Date; dueDate?: Date; supplierId?: Types.ObjectId; payee?: string; totalTTC: number; paidAmount?: number }>>();
  const suppliers = await SupplierModel.find({ tenantId: tid, _id: { $in: purchases.map(p => p.supplierId).filter(Boolean) } }).select("name").lean<Array<{ _id: Types.ObjectId; name: string }>>();
  const nameOf = new Map(suppliers.map(s => [String(s._id), s.name]));
  const rows = purchases.map(p => {
    const remaining = Math.max(0, Math.round(p.totalTTC - (p.paidAmount ?? 0)));
    // Sans échéance : vieillie à partir de la date de la facture plus 30 jours (délai par défaut).
    const assumed = !p.dueDate;
    const due = p.dueDate ?? new Date(new Date(p.date).getTime() + DEFAULT_TERM_DAYS * 86_400_000);
    return {
      _id: String(p._id), number: p.number, date: p.date, dueDate: p.dueDate ?? null, effectiveDue: due, assumedDue: assumed,
      supplierId: p.supplierId ? String(p.supplierId) : null,
      supplier: p.supplierId ? nameOf.get(String(p.supplierId)) ?? "(fiche supprimée)" : p.payee || "(sans fournisseur)",
      totalTTC: p.totalTTC, paid: p.paidAmount ?? 0, remaining, bucket: agingBucket(due, now),
    };
  }).filter(r => r.remaining > 0)
    // Les plus anciennes échéances d'abord, quelle que soit la façon dont la base classe les dates absentes.
    .sort((a, b) => new Date(a.effectiveDue).getTime() - new Date(b.effectiveDue).getTime());
  const empty = () => Object.fromEntries(BUCKETS.map(b => [b, 0])) as Record<AgingBucket, number>;
  const bySupplier = new Map<string, { supplierId: string | null; supplier: string; buckets: Record<AgingBucket, number>; total: number; count: number }>();
  const totals = empty();
  for (const r of rows) {
    const k = r.supplierId ?? `~${r.supplier}`;
    const cur = bySupplier.get(k) ?? { supplierId: r.supplierId, supplier: r.supplier, buckets: empty(), total: 0, count: 0 };
    cur.buckets[r.bucket] += r.remaining; cur.total += r.remaining; cur.count++;
    bySupplier.set(k, cur);
    totals[r.bucket] += r.remaining;
  }
  // Rapprochement avec la comptabilité : solde des comptes fournisseurs (40, hors avances 409).
  // L'écart vient de ce que l'échéancier ne voit pas : retenues à la source, immobilisations
  // achetées à crédit, à-nouveaux, OD, avances.
  const tenant = await TenantModel.findById(tid).select("closedFiscalYears").lean<{ closedFiscalYears?: number[] } | null>();
  const floor = balanceFloor(now, tenant?.closedFiscalYears ?? []);
  const [l] = await AccountingEntryModel.aggregate<{ d: number; c: number }>([
    { $match: { tenantId: tid, "lines.accountCode": { $regex: "^40(?!9)" }, ...(floor ? { entryDate: { $gte: floor } } : {}) } },
    { $unwind: "$lines" }, { $match: { "lines.accountCode": { $regex: "^40(?!9)" } } },
    { $group: { _id: null, d: { $sum: "$lines.debit" }, c: { $sum: "$lines.credit" } } },
  ]);
  const ledger = Math.round((l?.c ?? 0) - (l?.d ?? 0));
  return {
    ledger,
    rows,
    bySupplier: [...bySupplier.values()].sort((a, b) => b.total - a.total),
    totals, total: rows.reduce((t, r) => t + r.remaining, 0),
    overdue: rows.filter(r => r.bucket.startsWith("overdue")).reduce((t, r) => t + r.remaining, 0),
  };
}
