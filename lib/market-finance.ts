import { Types } from "mongoose";
import { InvoiceModel } from "@/models/Invoice";
import { DevisModel } from "@/models/Devis";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { CommandeModel } from "@/models/Commande";
import { PurchaseModel } from "@/models/Purchase";
import { retentionState, type RetentionState } from "@/lib/retention";
import { COST_CATEGORIES, costCategory, type CostCategoryKey } from "@/lib/cost-categories";
import { registrationEstimate } from "@/lib/registration-server";
import { PaymentModel } from "@/models/Payment";
import { costTypes } from "@/lib/market-costs";
import { amountsMismatch, lateInterest, marketBase, paymentDaysOf, penaltyEstimate, regulationEstimate, type MarketTerms } from "@/lib/market-terms";

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
  /** Retenue de garantie : gardée par le client jusqu'à la réception définitive. */
  retention: RetentionState & { rate: number };
  costs: {
    categories: Array<{ key: CostCategoryKey; label: string; hint: string; committed: number; actual: number }>;
    committed: number;
    actual: number;
    /** Reste à payer aux fournisseurs sur les achats validés imputés au marché. */
    supplierDueTTC: number;
    /** Détail par type de dépense ; `estimated` est la part calculée, pas encore saisie. */
    byType: Array<{ typeId: string | null; key?: string; label: string; accountCode?: string; committed: number; actual: number; estimated: number }>;
  };
  /** Conditions du marché et ce qu'elles donnent aujourd'hui. */
  terms: {
    base: number; baseKind: "TTC" | "HT"; paymentDays: number;
    regulation: { rate: number; threshold: number; applicable: boolean; estimate: number; recorded: number };
    penalty: { deadline: Date; delivered: boolean; daysLate: number; perDay: number; estimate: number; capped: boolean; recorded: number } | null;
    /** Intérêts moratoires calculés sur les factures dont la déclaration de créance est datée : à réclamer, hors marge. */
    lateInterest: { rate: number | null; total: number };
    /** Pénalités retenues par le client sur ses factures. */
    penaltyWithheld: number;
    /** Ce qui reste à régler à l'État avant tout paiement du client, et les saisies à revoir. */
    alerts: string[];
  };
  margin: { actual: number; actualRate: number | null; atCompletion: number; atCompletionRate: number | null; quoted: number | null };
  /** Droits d'enregistrement et timbres : estimés, constatés, payés, échéance. */
  registration: { estimate: number; kind: string; article: string; assessed: number; paid: number; dueDate: Date | null } | null;
  invoices: Array<{ _id: string; number: string; kind: string; documentType: string; status: string; issueDate: Date; totalHT: number; totalTTC: number; paidAmount: number; milestoneId?: string; dueDate?: Date; claimReceivedAt?: Date; daysLate: number; lateInterest: number }>;
}

type ContractLike = MarketTerms & {
  _id: unknown; amount: number; projectId?: unknown; devisId?: unknown; invoiceIds?: unknown[];
  type?: string; buyerType?: string; clientId?: unknown; instrument?: string; isSubcontract?: boolean; pages?: number; approvalDate?: Date; signedDate?: Date;
  registration?: { assessedAt?: Date; assessed?: number; paid?: number; dueDate?: Date } | null;
  retentionRate?: number; retentionReleases?: Array<{ amount: number }>; receptionProvisoireDate?: Date; receptionDefinitiveDate?: Date; guaranteeMonths?: number;
};
type InvoiceRow = {
  _id: Types.ObjectId; number: string; kind?: string; documentType: string; status: string; issueDate: Date; dueDate?: Date; claimReceivedAt?: Date; originalInvoiceId?: Types.ObjectId;
  totalHT: number; totalTTC: number; paidAmount: number; depositUsedHT?: number; retentionAmount?: number; milestoneId?: Types.ObjectId; lines: Array<{ totalHT: number; kind?: string }>;
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
      .select("number kind documentType status issueDate dueDate claimReceivedAt originalInvoiceId totalHT totalTTC paidAmount depositUsedHT retentionAmount milestoneId lines.totalHT lines.kind")
      .sort({ issueDate: 1 }).lean<InvoiceRow[]>(),
  ]);
  // Avoirs émis sur ces factures, même s'ils ne portent pas le marché.
  const credits = await InvoiceModel.find({ tenantId: tid, documentType: "credit_note", originalInvoiceId: { $in: base.map(i => i._id) }, _id: { $nin: base.map(i => i._id) } })
    .select("number kind documentType status issueDate originalInvoiceId totalHT totalTTC paidAmount lines.totalHT lines.kind").lean<InvoiceRow[]>();
  const all = [...base, ...credits];
  const cancelled = new Set(all.filter(i => i.documentType === "invoice" && i.status === "cancelled").map(i => String(i._id)));
  // Deux lectures. Le PLAFOND du marché (acomptes, travaux, reste à facturer)
  // compte les brouillons, comme la facturation qui les refuse au-delà. Le
  // facturé, l'encaissé, le dû, la retenue et la MARGE RÉELLE ne comptent que
  // les factures émises : un brouillon de 5 M faisait monter la marge et le
  // « dû » avant toute émission.
  const live = all.filter(i => i.documentType === "invoice" && !cancelled.has(String(i._id)));
  const issued = new Set(live.filter(i => i.status !== "draft").map(i => String(i._id)));
  // Avoir total → facture annulée : les deux sortent du calcul. Avoir partiel : retranché.
  const partials = all.filter(i => i.documentType === "credit_note" && !cancelled.has(String(i.originalInvoiceId)));

  let workHT = 0, workIssuedHT = 0, depositsHT = 0, deducted = 0, invoicedTTC = 0, collectedTTC = 0;
  for (const i of live) {
    const done = issued.has(String(i._id));
    if (done) { invoicedTTC += i.totalTTC; collectedTTC += i.paidAmount || 0; }
    if (i.kind === "deposit") { depositsHT += i.totalHT; deducted += i.depositUsedHT ?? 0; }
    else {
      const w = i.lines.filter(l => l.kind !== "deposit_deduction").reduce((t, l) => t + l.totalHT, 0);
      workHT += w; if (done) workIssuedHT += w;
    }
  }
  for (const c of partials) {
    invoicedTTC -= c.totalTTC;
    if (c.kind === "deposit") depositsHT -= c.totalHT; else { workHT -= c.totalHT; workIssuedHT -= c.totalHT; }
  }
  const outstanding = depositsHT - deducted;

  // Dépenses : réalisé (comptabilité) et engagé (commandes, achats en brouillon).
  const cats = new Map<CostCategoryKey, { committed: number; actual: number }>(COST_CATEGORIES.map(c => [c.key, { committed: 0, actual: 0 }]));
  let supplierDueTTC = 0;
  const types = await costTypes(tenantId);
  const typed = new Map<string, { committed: number; actual: number }>();
  let assessedImputed = 0;
  if (contract.projectId) {
    const pid = new Types.ObjectId(String(contract.projectId));
    const [actual, orders, drafts, validated, recorded] = await Promise.all([
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
      PurchaseModel.find({ tenantId: tid, status: { $ne: "cancelled" }, "lines.projectId": pid })
        .select("status lines").lean<Array<{ status: string; lines: Array<{ accountCode: string; amountHT: number; projectId?: unknown; costTypeId?: unknown }> }>>(),
    ]);
    // Une dépense saisie ailleurs (Dépenses) se range au type de son compte :
    // une redevance passée par là ne se compte pas en plus du calcul.
    const byAccount = new Map<string, string>();
    for (const t of types) if (!byAccount.has(t.accountCode)) byAccount.set(t.accountCode, String(t._id));
    for (const p of recorded) for (const l of p.lines) {
      const typeId = l.costTypeId ? String(l.costTypeId) : byAccount.get(l.accountCode);
      if (!typeId || String(l.projectId ?? "") !== String(pid)) continue;
      const t = typed.get(typeId) ?? { committed: 0, actual: 0 };
      t[p.status === "draft" ? "committed" : "actual"] += l.amountHT;
      typed.set(typeId, t);
    }
    assessedImputed = actual.filter(a => a._id.startsWith("646")).reduce((t, a) => t + a.net, 0);
    for (const a of actual) cats.get(costCategory(a._id))!.actual += a.net;
    for (const o of orders) cats.get("materials")!.committed += o.totalHT ?? 0;
    for (const p of drafts) for (const l of p.lines) if (String(l.projectId ?? "") === String(pid)) cats.get(costCategory(l.accountCode))!.committed += l.amountHT;
    for (const p of validated) {
      const share = p.totalHT > 0 ? p.lines.filter(l => String(l.projectId ?? "") === String(pid)).reduce((t, l) => t + l.amountHT, 0) / p.totalHT : 0;
      supplierDueTTC += Math.round((p.totalTTC - (p.paidAmount || 0)) * share);
    }
  }
  // Droits d'enregistrement et timbres du marché : engagés tant qu'ils ne sont
  // que dus (estimation), réalisés une fois constatés. Avec un projet
  // d'exécution, le constat (646 imputé au projet) est déjà compté ci-dessus.
  let registration: MarketFinance["registration"] = null;
  let buyerType: string | undefined;
  if (contract.type === "client" && (contract.amount ?? 0) > 0) {
    const est = await registrationEstimate(tenantId, contract as Parameters<typeof registrationEstimate>[1]);
    buyerType = est.buyerType;
    const reg = contract.registration;
    if (!reg?.assessedAt) cats.get("registration")!.committed += est.total;
    // Constat antérieur au projet : son écriture ne porte pas le projet, le montant reste une charge du marché.
    else cats.get("registration")!.actual += Math.max(0, (reg.assessed ?? 0) - assessedImputed);
    registration = {
      estimate: est.total, kind: est.kind, article: est.article,
      assessed: reg?.assessed ?? 0, paid: reg?.paid ?? 0,
      dueDate: (reg?.dueDate ?? est.dueDate ?? null) as Date | null,
    };
  }
  // Redevance et pénalités : engagées pour leur montant calculé ; ce qui est
  // saisi s'en déduit, sans le doubler (plusieurs paiements restent possibles).
  const typeOf = (key: string) => types.find(t => t.key === key);
  // Toutes les factures, annulées comprises : la charge reste en comptabilité tant que la retenue n'est pas annulée.
  const withheldRows = base.length ? await PaymentModel.find({ tenantId: tid, invoiceId: { $in: base.map(i => i._id) }, status: "effective", penaltyAmount: { $gt: 0 } })
    .select("penaltyAmount").lean<Array<{ penaltyAmount: number }>>() : [];
  const penaltyWithheld = withheldRows.reduce((t, p) => t + p.penaltyAmount, 0);
  const penaltyType = typeOf("penalty");
  if (penaltyWithheld && penaltyType) {
    const v = typed.get(String(penaltyType._id)) ?? { committed: 0, actual: 0 };
    typed.set(String(penaltyType._id), { ...v, actual: v.actual + penaltyWithheld });
  }
  const recordedOf = (key: string) => { const t = typeOf(key), v = t ? typed.get(String(t._id)) : undefined; return (v?.committed ?? 0) + (v?.actual ?? 0); };
  const isMarket = contract.type === "client";
  const reg = regulationEstimate(contract, buyerType);
  const pen = isMarket ? penaltyEstimate(contract, new Date(), buyerType) : null;
  const pending = new Map<string, number>();
  const expect = (key: string, estimate: number) => {
    const rest = Math.max(0, estimate - recordedOf(key)), t = typeOf(key);
    if (!isMarket || rest <= 0 || !t) return;
    pending.set(String(t._id), rest);
    cats.get(costCategory(t.accountCode))!.committed += rest;
  };
  expect("regulation", reg.estimate);
  expect("penalty", pen?.estimate ?? 0);

  const categories = COST_CATEGORIES.map(c => ({ key: c.key, label: c.label, hint: c.hint, committed: Math.round(cats.get(c.key)!.committed), actual: Math.round(cats.get(c.key)!.actual) }));
  const committed = categories.reduce((t, c) => t + c.committed, 0);
  const actualCost = categories.reduce((t, c) => t + c.actual, 0);
  const contractHT = contract.amount || 0;
  const retention = retentionState(live.filter(i => issued.has(String(i._id))), contract);

  // Détail par type : les types utilisés ou calculés, les droits d'enregistrement,
  // puis le reste de ce qui est imputé au projet (achats sans type, paie, commandes).
  const byType: MarketFinance["costs"]["byType"] = types
    .filter(t => typed.has(String(t._id)) || pending.has(String(t._id)))
    .map(t => {
      const v = typed.get(String(t._id)) ?? { committed: 0, actual: 0 }, est = Math.round(pending.get(String(t._id)) ?? 0);
      return { typeId: String(t._id), key: t.key, label: t.label, accountCode: t.accountCode, committed: Math.round(v.committed) + est, actual: Math.round(v.actual), estimated: est };
    });
  if (registration) byType.push({ typeId: null, key: "registration", label: "Droits d'enregistrement et timbres", committed: contract.registration?.assessedAt ? 0 : registration.estimate, actual: registration.assessed, estimated: contract.registration?.assessedAt ? 0 : registration.estimate });
  const restCommitted = Math.max(0, committed - byType.reduce((t, r) => t + r.committed, 0));
  const restActual = Math.max(0, actualCost - byType.reduce((t, r) => t + r.actual, 0));
  if (restCommitted || restActual) byType.push({ typeId: null, key: "untyped", label: "Autres dépenses imputées au projet", committed: restCommitted, actual: restActual, estimated: 0 });

  // Intérêts moratoires : seulement à partir d'une réception datée, qui seule fait courir le délai.
  const interestRate = contract.lateInterestRate ?? null;
  const claimed = live.filter(i => issued.has(String(i._id)) && i.claimReceivedAt && i.dueDate);
  const settlements = claimed.length ? await PaymentModel.find({ tenantId: tid, invoiceId: { $in: claimed.map(i => i._id) }, status: "effective" })
    .select("invoiceId date amount withholdingAmount exchangeDifference penaltyAmount").lean<Array<{ invoiceId: Types.ObjectId; date: Date; amount: number; withholdingAmount?: number; exchangeDifference?: number; penaltyAmount?: number }>>() : [];
  const delays = new Map(claimed.map(i => {
    const credited = partials.filter(c => String(c.originalInvoiceId) === String(i._id)).reduce((t, c) => t + c.totalTTC, 0);
    return [String(i._id), lateInterest({
      dueDate: i.dueDate!, amountDue: i.totalTTC - (i.retentionAmount ?? 0) - credited, annualRate: interestRate ?? 0,
      payments: settlements.filter(p => String(p.invoiceId) === String(i._id)).map(p => ({ date: p.date, amount: p.amount + (p.withholdingAmount ?? 0) + (p.exchangeDifference ?? 0) + (p.penaltyAmount ?? 0) })),
    })] as const;
  }));
  const reference = marketBase(contract);
  const regulationPaid = (() => { const t = typeOf("regulation"); return t ? typed.get(String(t._id))?.actual ?? 0 : 0; })();
  const registrationLeft = registration ? Math.max(0, (registration.assessed || registration.estimate) - registration.paid) : 0;
  const regulationLeft = reg.applicable ? Math.max(0, reg.estimate - regulationPaid) : 0;
  const alerts: string[] = [];
  if (pen?.capped) alerts.push("Pénalités plafonnées : l'acheteur public peut résilier le marché à ce niveau (art. 158 du Code des marchés publics).");
  if (amountsMismatch(contract)) alerts.push("Le montant HT, le montant TTC et la TVA du marché ne concordent pas : vérifiez-les, la marge en dépend.");
  if (registrationLeft + regulationLeft > 0 && reg.applicable) alerts.push(`Reste à régler à l'État avant tout paiement du client (art. 166 du Code des marchés publics) : ${(registrationLeft + regulationLeft).toLocaleString("fr-FR")} FCFA (enregistrement ${registrationLeft.toLocaleString("fr-FR")}, redevance ${regulationLeft.toLocaleString("fr-FR")}).`);

  return {
    quote: quote ? { _id: String(quote._id), number: quote.number, status: quote.status, totalHT: quote.totalHT, totalTTC: quote.totalTTC } : null,
    contractHT,
    billing: {
      workHT, depositsHT, depositsDeductedHT: deducted, depositsOutstandingHT: outstanding,
      // Encaissé : règlements et retenues déjà reversées ; dû : l'exigible, hors retenue.
      invoicedTTC, collectedTTC: collectedTTC + retention.released - penaltyWithheld, dueTTC: Math.max(0, invoicedTTC - collectedTTC - retention.held),
      toInvoiceHT: Math.max(0, contractHT - workHT - outstanding),
    },
    retention: { ...retention, rate: contract.retentionRate ?? 0 },
    costs: { categories, committed, actual: actualCost, supplierDueTTC, byType },
    terms: {
      base: reference.amount, baseKind: reference.kind, paymentDays: paymentDaysOf(contract),
      regulation: { rate: reg.rate, threshold: reg.threshold, applicable: reg.applicable, estimate: reg.estimate, recorded: recordedOf("regulation") },
      penalty: pen ? { deadline: pen.deadline, delivered: pen.delivered, daysLate: pen.daysLate, perDay: pen.perDay, estimate: pen.estimate, capped: pen.capped, recorded: recordedOf("penalty") } : null,
      lateInterest: { rate: interestRate, total: [...delays.values()].reduce((t, d) => t + d.interest, 0) },
      penaltyWithheld, alerts,
    },
    margin: {
      actual: workIssuedHT - actualCost, actualRate: rate(workIssuedHT - actualCost, workIssuedHT),
      atCompletion: contractHT - actualCost - committed, atCompletionRate: rate(contractHT - actualCost - committed, contractHT),
      quoted: quote ? quote.totalHT : null,
    },
    registration,
    invoices: all.map(i => ({
      _id: String(i._id), number: i.number, kind: i.kind ?? "standard", documentType: i.documentType, status: i.status, issueDate: i.issueDate,
      totalHT: i.totalHT, totalTTC: i.totalTTC, paidAmount: i.paidAmount || 0, ...(i.milestoneId ? { milestoneId: String(i.milestoneId) } : {}),
      dueDate: i.dueDate, claimReceivedAt: i.claimReceivedAt, daysLate: delays.get(String(i._id))?.daysLate ?? 0, lateInterest: delays.get(String(i._id))?.interest ?? 0,
    })),
  };
}
