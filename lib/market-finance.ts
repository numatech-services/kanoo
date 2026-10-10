import { Types } from "mongoose";
import { InvoiceModel } from "@/models/Invoice";
import { DevisModel } from "@/models/Devis";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { CommandeModel } from "@/models/Commande";
import { PurchaseModel } from "@/models/Purchase";
import { COST_CATEGORIES, costCategory, type CostCategoryKey } from "@/lib/cost-categories";

export interface MarketFinance {
  quote: { _id: string; number: string; status: string; totalHT: number; totalTTC: number } | null;
  contractHT: number;
  billing: {
    /** Travaux facturés HT (acomptes déduits compris), avoirs retirés. */
    workHT: number;
    depositsHT: number;
    depositsDeductedHT: number;
    depositsOutstandingHT: number;
    invoicedTTC: number;
    collectedTTC: number;
    dueTTC: number;
    toInvoiceHT: number;
  };
  costs: {
    categories: Array<{ key: CostCategoryKey; label: string; hint: string; committed: number; actual: number }>;
    committed: number;
    actual: number;
    /** Reste à payer aux fournisseurs sur les achats validés imputés au marché. */
    supplierDueTTC: number;
  };
  margin: { actual: number; actualRate: number | null; atCompletion: number; atCompletionRate: number | null; quoted: number | null };
  invoices: Array<{ _id: string; number: string; kind: string; documentType: string; status: string; issueDate: Date; totalHT: number; totalTTC: number; paidAmount: number; milestoneId?: string }>;
}

type ContractLike = { _id: unknown; amount: number; projectId?: unknown; devisId?: unknown; invoiceIds?: unknown[] };
type InvoiceRow = {
  _id: Types.ObjectId; number: string; kind?: string; documentType: string; status: string; issueDate: Date; originalInvoiceId?: Types.ObjectId;
  totalHT: number; totalTTC: number; paidAmount: number; depositUsedHT?: number; milestoneId?: Types.ObjectId; lines: Array<{ totalHT: number; kind?: string }>;
};

const rate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

/**
 * Situation financière d'un marché, montants séparés :
 * devis → marché → acomptes → facturé / encaissé → dépenses par catégorie
 * (engagées et réalisées) → marges réelle et à terminaison.
 *
 * Les dépenses sont celles imputées au projet d'exécution du marché, lues en
 * comptabilité (réalisé) et sur les bons de commande / achats non encore
 * comptabilisés (engagé). Le chiffre d'affaires est celui des factures du
 * marché ; un acompte n'est pas du chiffre d'affaires tant qu'il n'est pas déduit.
 */
export async function marketFinance(tenantId: string, contract: ContractLike): Promise<MarketFinance> {
  const tid = new Types.ObjectId(tenantId);
  const linked = (contract.invoiceIds ?? []).map(id => new Types.ObjectId(String(id)));
  const [quote, base] = await Promise.all([
    contract.devisId ? DevisModel.findOne({ _id: contract.devisId, tenantId: tid }).select("number status totalHT totalTTC").lean<{ _id: Types.ObjectId; number: string; status: string; totalHT: number; totalTTC: number } | null>() : null,
    InvoiceModel.find({ tenantId: tid, $or: [{ contractId: contract._id }, { _id: { $in: linked } }] })
      .select("number kind documentType status issueDate originalInvoiceId totalHT totalTTC paidAmount depositUsedHT milestoneId lines.totalHT lines.kind")
      .sort({ issueDate: 1 }).lean<InvoiceRow[]>(),
  ]);
  // Avoirs émis sur ces factures, même s'ils ne portent pas le marché.
  const credits = await InvoiceModel.find({ tenantId: tid, documentType: "credit_note", originalInvoiceId: { $in: base.map(i => i._id) }, _id: { $nin: base.map(i => i._id) } })
    .select("number kind documentType status issueDate originalInvoiceId totalHT totalTTC paidAmount lines.totalHT lines.kind").lean<InvoiceRow[]>();
  const all = [...base, ...credits];
  const cancelled = new Set(all.filter(i => i.documentType === "invoice" && i.status === "cancelled").map(i => String(i._id)));
  const live = all.filter(i => i.documentType === "invoice" && !cancelled.has(String(i._id)));
  // Avoir total → facture annulée : les deux sortent du calcul. Avoir partiel : retranché.
  const partials = all.filter(i => i.documentType === "credit_note" && !cancelled.has(String(i.originalInvoiceId)));

  let workHT = 0, depositsHT = 0, deducted = 0, invoicedTTC = 0, collectedTTC = 0;
  for (const i of live) {
    invoicedTTC += i.totalTTC; collectedTTC += i.paidAmount || 0;
    if (i.kind === "deposit") { depositsHT += i.totalHT; deducted += i.depositUsedHT ?? 0; }
    else workHT += i.lines.filter(l => l.kind !== "deposit_deduction").reduce((t, l) => t + l.totalHT, 0);
  }
  for (const c of partials) {
    invoicedTTC -= c.totalTTC;
    if (c.kind === "deposit") depositsHT -= c.totalHT; else workHT -= c.totalHT;
  }
  const outstanding = depositsHT - deducted;

  // Dépenses : réalisé (comptabilité) et engagé (commandes, achats en brouillon).
  const cats = new Map<CostCategoryKey, { committed: number; actual: number }>(COST_CATEGORIES.map(c => [c.key, { committed: 0, actual: 0 }]));
  let supplierDueTTC = 0;
  if (contract.projectId) {
    const pid = new Types.ObjectId(String(contract.projectId));
    const [actual, orders, drafts, validated] = await Promise.all([
      AccountingEntryModel.aggregate<{ _id: string; net: number }>([
        { $match: { tenantId: tid, "lines.projectId": pid } },
        { $unwind: "$lines" },
        { $match: { "lines.projectId": pid, "lines.accountCode": { $regex: "^6" } } },
        { $group: { _id: "$lines.accountCode", net: { $sum: { $subtract: ["$lines.debit", "$lines.credit"] } } } },
      ]),
      CommandeModel.find({ tenantId: tid, projectId: pid, status: { $in: ["confirmed", "partially_received", "received"] }, purchaseId: { $exists: false } })
        .select("totalHT").lean<Array<{ totalHT?: number }>>(),
      PurchaseModel.find({ tenantId: tid, status: "draft", "lines.projectId": pid }).select("lines").lean<Array<{ lines: Array<{ accountCode: string; amountHT: number; projectId?: unknown }> }>>(),
      PurchaseModel.find({ tenantId: tid, status: { $in: ["validated", "partial"] }, "lines.projectId": pid })
        .select("lines totalHT totalTTC paidAmount").lean<Array<{ totalHT: number; totalTTC: number; paidAmount: number; lines: Array<{ amountHT: number; projectId?: unknown }> }>>(),
    ]);
    for (const a of actual) cats.get(costCategory(a._id))!.actual += a.net;
    for (const o of orders) cats.get("materials")!.committed += o.totalHT ?? 0;
    for (const p of drafts) for (const l of p.lines) if (String(l.projectId ?? "") === String(pid)) cats.get(costCategory(l.accountCode))!.committed += l.amountHT;
    for (const p of validated) {
      const share = p.totalHT > 0 ? p.lines.filter(l => String(l.projectId ?? "") === String(pid)).reduce((t, l) => t + l.amountHT, 0) / p.totalHT : 0;
      supplierDueTTC += Math.round((p.totalTTC - (p.paidAmount || 0)) * share);
    }
  }
  const categories = COST_CATEGORIES.map(c => ({ key: c.key, label: c.label, hint: c.hint, committed: Math.round(cats.get(c.key)!.committed), actual: Math.round(cats.get(c.key)!.actual) }));
  const committed = categories.reduce((t, c) => t + c.committed, 0);
  const actualCost = categories.reduce((t, c) => t + c.actual, 0);
  const contractHT = contract.amount || 0;

  return {
    quote: quote ? { _id: String(quote._id), number: quote.number, status: quote.status, totalHT: quote.totalHT, totalTTC: quote.totalTTC } : null,
    contractHT,
    billing: {
      workHT, depositsHT, depositsDeductedHT: deducted, depositsOutstandingHT: outstanding,
      invoicedTTC, collectedTTC, dueTTC: Math.max(0, invoicedTTC - collectedTTC),
      toInvoiceHT: Math.max(0, contractHT - workHT - outstanding),
    },
    costs: { categories, committed, actual: actualCost, supplierDueTTC },
    margin: {
      actual: workHT - actualCost, actualRate: rate(workHT - actualCost, workHT),
      atCompletion: contractHT - actualCost - committed, atCompletionRate: rate(contractHT - actualCost - committed, contractHT),
      quoted: quote ? quote.totalHT : null,
    },
    invoices: all.map(i => ({
      _id: String(i._id), number: i.number, kind: i.kind ?? "standard", documentType: i.documentType, status: i.status, issueDate: i.issueDate,
      totalHT: i.totalHT, totalTTC: i.totalTTC, paidAmount: i.paidAmount || 0, ...(i.milestoneId ? { milestoneId: String(i.milestoneId) } : {}),
    })),
  };
}
