import { Types } from "mongoose";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { ActivityModel } from "@/models/Activity";
import { InvoiceModel } from "@/models/Invoice";
import { PurchaseModel } from "@/models/Purchase";
import { LoanModel } from "@/models/Loan";
import { BankGuaranteeModel } from "@/models/BankGuarantee";
import { TreasuryAccountModel } from "@/models/TreasuryAccount";
import { accountBalance } from "@/lib/treasury";
import { INVOICE_DUE_EXPR, BOOKED_INVOICE_MATCH } from "@/lib/payments";
import { loanState } from "@/lib/loans-server";
import { commitments } from "@/lib/guarantees";
import { syscohadaIncomeStatement } from "@/lib/financial-statements";

/**
 * Cockpit : la performance de toute l'organisation sur une page, lue dans la
 * comptabilité (écritures validées, extournes comprises) et dans les pièces
 * ouvertes. Chiffres de gestion, à rapprocher des états de fin d'exercice.
 */
export interface Cockpit {
  year: number; from: Date; to: Date;
  /** Soldes (trésorerie, créances, dettes, emprunts, cautions) lus à cette date : aujourd'hui, même pour un exercice passé. */
  balancesAsOf: Date; currentYear: boolean;
  result: { revenue: number; operatingCharges: number; personnel: number; depreciation: number; interest: number; operatingResult: number; net: number; ebitda: number };
  activities: Array<{ id: string | null; name: string; revenue: number; charges: number; margin: number; marginRate: number | null }>;
  months: Array<{ month: string; revenue: number; charges: number }>;
  treasury: { total: number; accounts: Array<{ label: string; type: string; balance: number }> };
  receivables: { due: number; overdue: number; count: number };
  payables: { due: number; overdue: number };
  debt: { loans: number; overdueInstallments: number; interestLeft: number; guaranteesGiven: number; guaranteesReceived: number };
  ratios: { netDebt: number; workingCapital: number; dso: number | null; dpo: number | null; interestCover: number | null; netMargin: number | null; debtToRevenue: number | null };
}

const rate = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

/**
 * `asOf` : date d'arrêté du résultat (par défaut maintenant ; fin du mois
 * écoulé pour le point mensuel). Les soldes sont toujours ceux du jour.
 */
export async function computeCockpit(tenantId: string, year: number, now = new Date(), asOf?: Date): Promise<Cockpit> {
  const tid = new Types.ObjectId(tenantId);
  const end = asOf ?? now;
  const currentYear = year === end.getUTCFullYear();
  const from = new Date(Date.UTC(year, 0, 1)), to = currentYear ? end : new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000));

  // Classes 6 et 7 de l'exercice, par compte (2 chiffres), activité et mois.
  const rows = await AccountingEntryModel.aggregate<{ _id: { p: string; a: unknown; m: string }; net: number }>([
    { $match: { tenantId: tid, entryDate: { $gte: from, $lte: to } } },
    { $unwind: "$lines" },
    { $match: { "lines.accountCode": { $regex: "^[67]" } } },
    { $group: { _id: { p: { $substrCP: ["$lines.accountCode", 0, 2] }, a: "$lines.activityId", m: { $dateToString: { format: "%Y-%m", date: "$entryDate" } } }, net: { $sum: { $subtract: ["$lines.credit", "$lines.debit"] } } } },
  ]);
  // Résultat : le compte de résultat SYSCOHADA de l'application (classes 6, 7 et 8), au compte près.
  const byCode = await AccountingEntryModel.aggregate<{ _id: string; debit: number; credit: number }>([
    { $match: { tenantId: tid, entryDate: { $gte: from, $lte: to } } },
    { $unwind: "$lines" },
    { $match: { "lines.accountCode": { $regex: "^[678]" } } },
    { $group: { _id: "$lines.accountCode", debit: { $sum: "$lines.debit" }, credit: { $sum: "$lines.credit" } } },
  ]);
  const is = syscohadaIncomeStatement(byCode.map(r => ({ code: r._id, debit: r.debit, credit: r.credit })));
  const line = (ref: string) => is.lines.find(l => l.ref === ref)?.amount ?? 0;
  const chargeOf = (re: RegExp) => byCode.filter(r => re.test(r._id)).reduce((t, r) => t + r.debit - r.credit, 0);
  const revenue = is.chiffreAffaires, ebitda = is.ebe, net = is.resultat;
  const personnel = -line("RK"), depreciation = -line("RL");
  const operatingCharges = chargeOf(/^6[0-5]/);
  const interest = chargeOf(/^67[1-4]/);
  // Activités et mois : produits d'exploitation (70 à 75) et charges d'exploitation (60 à 66, 68, 69).
  const isProd = (p: string) => /^7[0-5]$/.test(p), isCharge = (p: string) => /^6[0-6]$|^6[89]$/.test(p);

  const actIds = [...new Set(rows.map(r => String(r._id.a ?? "")).filter(Boolean))];
  const acts = actIds.length ? await ActivityModel.find({ tenantId: tid, _id: { $in: actIds } }).select("name").lean<Array<{ _id: unknown; name: string }>>() : [];
  const actName = new Map(acts.map(a => [String(a._id), a.name]));
  const byAct = new Map<string, { revenue: number; charges: number }>();
  for (const r of rows) {
    const k = String(r._id.a ?? "");
    const v = byAct.get(k) ?? { revenue: 0, charges: 0 };
    if (isProd(r._id.p)) v.revenue += r.net; else if (isCharge(r._id.p)) v.charges -= r.net;
    byAct.set(k, v);
  }
  const activities = [...byAct].map(([k, v]) => ({ id: k || null, name: k ? actName.get(k) ?? "Secteur supprimé" : "Non imputé", revenue: Math.round(v.revenue), charges: Math.round(v.charges), margin: Math.round(v.revenue - v.charges), marginRate: rate(v.revenue - v.charges, v.revenue) }))
    .sort((a, b) => (a.id === null ? 1 : b.id === null ? -1 : b.revenue - a.revenue));
  const byMonth = new Map<string, { revenue: number; charges: number }>();
  for (const r of rows) { const v = byMonth.get(r._id.m) ?? { revenue: 0, charges: 0 }; if (isProd(r._id.p)) v.revenue += r.net; else if (isCharge(r._id.p)) v.charges -= r.net; byMonth.set(r._id.m, v); }
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`).map(m => ({ month: m, revenue: Math.round(byMonth.get(m)?.revenue ?? 0), charges: Math.round(byMonth.get(m)?.charges ?? 0) }));

  const accounts = await TreasuryAccountModel.find({ tenantId: tid, isActive: { $ne: false } }).select("label type").lean<Array<{ _id: unknown; label: string; type: string }>>();
  const balances = await Promise.all(accounts.map(a => accountBalance(tenantId, String(a._id))));
  const treasuryAccounts = accounts.map((a, i) => ({ id: String(a._id), label: a.label, type: a.type, balance: Math.round(balances[i]?.balance ?? 0) }));
  const cash = treasuryAccounts.reduce((t, a) => t + a.balance, 0);

  const [rec] = await InvoiceModel.aggregate<{ due: number; overdue: number; n: number }>([
    { $match: { tenantId: tid, documentType: { $ne: "credit_note" }, status: { $in: ["sent", "partial", "overdue"] }, ...BOOKED_INVOICE_MATCH } },
    { $group: { _id: null, due: { $sum: INVOICE_DUE_EXPR }, overdue: { $sum: { $cond: [{ $lt: ["$dueDate", now] }, INVOICE_DUE_EXPR, 0] } }, n: { $sum: 1 } } },
  ]);
  const [pay] = await PurchaseModel.aggregate<{ due: number; overdue: number }>([
    { $match: { tenantId: tid, status: { $in: ["validated", "partial"] } } },
    { $group: { _id: null, due: { $sum: { $subtract: ["$totalTTC", { $ifNull: ["$paidAmount", 0] }] } }, overdue: { $sum: { $cond: [{ $lt: ["$dueDate", now] }, { $subtract: ["$totalTTC", { $ifNull: ["$paidAmount", 0] }] }, 0] } } } },
  ]);
  const loans = await LoanModel.find({ tenantId: tid, status: { $in: ["active"] } }).lean<Array<Parameters<typeof loanState>[0]>>();
  const states = loans.map(l => loanState(l));
  const guarantees = await BankGuaranteeModel.find({ tenantId: tid, status: "active" }).select("type amount status collateral direction").lean<Parameters<typeof commitments>[0]>();
  const com = commitments(guarantees);
  const loanDebt = states.reduce((t, s) => t + s.remaining, 0);
  const overdraft = treasuryAccounts.filter(a => a.balance < 0).reduce((t, a) => t - a.balance, 0);
  const receivablesDue = Math.round(rec?.due ?? 0), payablesDue = Math.round(pay?.due ?? 0);
  const salesTTC = revenue * 1.19; // approximation : délais calculés sur un chiffre TTC estimé (TVA normale)
  const purchasesTTC = operatingCharges * 1.19;

  return {
    year, from, to, balancesAsOf: now, currentYear,
    result: { revenue: Math.round(revenue), operatingCharges: Math.round(operatingCharges), personnel: Math.round(personnel), depreciation: Math.round(depreciation), interest: Math.round(interest), operatingResult: Math.round(is.resultatExploitation), net: Math.round(net), ebitda: Math.round(ebitda) },
    activities, months,
    treasury: { total: cash, accounts: treasuryAccounts },
    receivables: { due: receivablesDue, overdue: Math.round(rec?.overdue ?? 0), count: rec?.n ?? 0 },
    payables: { due: payablesDue, overdue: Math.round(pay?.overdue ?? 0) },
    debt: { loans: loanDebt, overdueInstallments: states.reduce((t, s) => t + s.overdue.amount, 0), interestLeft: states.reduce((t, s) => t + s.interestLeft, 0), guaranteesGiven: com.total, guaranteesReceived: com.received },
    ratios: {
      // Découverts ajoutés à la dette, seuls les soldes positifs déduits (pas de double compte).
      netDebt: loanDebt + overdraft - treasuryAccounts.filter(a => a.balance > 0).reduce((t, a) => t + a.balance, 0),
      workingCapital: receivablesDue - payablesDue,
      // Encours du jour rapportés aux flux de l'exercice : sans objet pour un exercice passé.
      dso: currentYear && salesTTC > 0 ? Math.round(receivablesDue / salesTTC * days) : null,
      dpo: currentYear && purchasesTTC > 0 ? Math.round(payablesDue / purchasesTTC * days) : null,
      interestCover: interest > 0 ? Math.round((ebitda / interest) * 10) / 10 : null,
      netMargin: rate(net, revenue),
      debtToRevenue: currentYear ? rate(loanDebt, revenue * 365 / days) : null,
    },
  };
}

/** Texte court du point mensuel (notification). */
export function cockpitSummary(c: Cockpit, fmt: (n: number) => string) {
  return [
    `Du 1er janvier au ${c.to.toISOString().slice(8, 10)}/${c.to.toISOString().slice(5, 7)}/${c.year} : chiffre d'affaires ${fmt(c.result.revenue)}, résultat net ${fmt(c.result.net)}${c.ratios.netMargin !== null ? ` (${c.ratios.netMargin} %)` : ""}.`,
    `Trésorerie ${fmt(c.treasury.total)} ; créances clients ${fmt(c.receivables.due)} dont ${fmt(c.receivables.overdue)} en retard ; dettes fournisseurs ${fmt(c.payables.due)}.`,
    `Emprunts restant dus ${fmt(c.debt.loans)}${c.debt.overdueInstallments ? `, dont ${fmt(c.debt.overdueInstallments)} d'échéances en retard` : ""} ; cautions en cours ${fmt(c.debt.guaranteesGiven)}.`,
  ].join(" ");
}
