import { Types } from "mongoose";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { InvoiceModel } from "@/models/Invoice";
import { FixedAssetModel } from "@/models/FixedAsset";
import { ProductModel } from "@/models/Product";

/** Résultat en instance d'affectation (SYSCOHADA 130). */
export const RESULT_ACCOUNT = "130000";

/** Comptes de tiers dont les à-nouveaux sont ventilés par tiers. */
export const THIRD_PARTY_ACCOUNT = /^4[0-2]/;

/** Destinations possibles du résultat, à la décision de l'assemblée. */
export const ALLOCATION_ACCOUNTS: Record<string, string> = {
  "111000": "Réserve légale",
  "112000": "Réserves statutaires",
  "118000": "Autres réserves",
  "121000": "Report à nouveau créditeur",
  "129000": "Report à nouveau débiteur",
  "465000": "Associés, dividendes à payer",
};

export interface ClosingCheck { level: "block" | "warn"; code: string; message: string }

/**
 * Contrôles avant clôture d'un exercice. La clôture ne vérifiait rien : on
 * pouvait clôturer sans dotations, sans variation de stock, avec un compte
 * d'attente non soldé ou des factures en brouillon — puis l'exercice était
 * verrouillé à jamais.
 */
export async function closingChecks(tenantId: string, year: number): Promise<ClosingCheck[]> {
  const tid = new Types.ObjectId(tenantId);
  const start = new Date(year, 0, 1), end = new Date(year, 11, 31, 23, 59, 59);
  const checks: ClosingCheck[] = [];
  if (year >= new Date().getFullYear()) {
    checks.push({ level: "block", code: "current_year", message: `L'exercice ${year} n'est pas terminé.` });
  }

  const [drafts, assets, waiting, stockEntry, stocked] = await Promise.all([
    InvoiceModel.countDocuments({ tenantId: tid, status: "draft", issueDate: { $gte: start, $lte: end } }),
    FixedAssetModel.countDocuments({ tenantId: tid, depreciationSchedule: { $elemMatch: { year, posted: { $ne: true }, annuity: { $gt: 0 } } } }),
    AccountingEntryModel.aggregate<{ debit: number; credit: number }>([
      { $match: { tenantId: tid, entryDate: { $lte: end } } }, { $unwind: "$lines" },
      { $match: { "lines.accountCode": { $regex: "^47[0-1]" } } },
      { $group: { _id: null, debit: { $sum: "$lines.debit" }, credit: { $sum: "$lines.credit" } } },
    ]),
    AccountingEntryModel.exists({ tenantId: tid, reference: { $regex: `^VAR-STOCK-${year}-` } }),
    ProductModel.exists({ tenantId: tid, stockQty: { $gt: 0 }, isService: { $ne: true } }),
  ]);
  if (drafts > 0) checks.push({ level: "warn", code: "draft_invoices", message: `${drafts} facture(s) en brouillon datée(s) de ${year} : émettez-les ou supprimez-les.` });
  if (assets > 0) checks.push({ level: "warn", code: "depreciation", message: `${assets} immobilisation(s) sans dotation ${year} passée.` });
  const w = waiting[0] ? Math.round(waiting[0].debit - waiting[0].credit) : 0;
  if (w !== 0) checks.push({ level: "warn", code: "suspense", message: `Compte d'attente (47) non soldé au 31/12/${year} : ${w.toLocaleString("fr-FR")} FCFA.` });
  if (stocked && !stockEntry) checks.push({ level: "warn", code: "stock_variation", message: `Pas de variation de stock passée pour ${year} alors que des articles sont en stock.` });
  return checks;
}

/** Soldes des comptes de tiers (40 à 42) par compte et par tiers sur une période. */
export async function thirdPartyBalances(tenantId: string, from: Date | undefined, to: Date) {
  const rows = await AccountingEntryModel.aggregate<{ _id: { code: string; tp: unknown }; debit: number; credit: number }>([
    { $match: { tenantId: new Types.ObjectId(tenantId), entryDate: { ...(from ? { $gte: from } : {}), $lte: to } } },
    { $unwind: "$lines" },
    { $match: { "lines.accountCode": { $regex: "^4[0-2]" } } },
    { $group: { _id: { code: "$lines.accountCode", tp: "$lines.thirdPartyId" }, debit: { $sum: "$lines.debit" }, credit: { $sum: "$lines.credit" } } },
  ]);
  return rows.map(r => ({ code: r._id.code, thirdPartyId: r._id.tp ?? undefined, debit: r.debit, credit: r.credit }));
}
