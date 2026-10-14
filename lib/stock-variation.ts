import { Types, type ClientSession } from "mongoose";
import { StockMovementModel } from "@/models/StockMovement";
import { ProductModel } from "@/models/Product";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { BusinessRuleError } from "@/lib/errors";

/**
 * Variation de stock — inventaire intermittent (SYSCOHADA).
 *
 * Les achats de marchandises sont des charges (601) ; le compte de stock (31)
 * n'est mis à jour qu'en fin de période, par la variation : stock final moins
 * stock déjà porté au bilan. Sans cette écriture, le bilan ignorait la valeur
 * des marchandises en magasin et le résultat comptait comme consommé tout ce
 * qui avait été acheté.
 *
 *   stock en hausse : 31 au débit / 6031 au crédit
 *   stock en baisse : 6031 au débit / 31 au crédit
 *
 * Valeur du stock à la date : pour chaque article, le dernier mouvement
 * antérieur donne le stock total et le coût moyen pondéré (CMUP) d'alors.
 */

export const STOCK_ACCOUNT = { accountCode: "311000", accountLabel: "Marchandises" };
export const VARIATION_ACCOUNT = { accountCode: "603100", accountLabel: "Variations des stocks de marchandises" };

export async function stockValueAt(tenantId: string, date: Date, session?: ClientSession) {
  const tid = new Types.ObjectId(tenantId);
  const last = await StockMovementModel.aggregate<{ _id: unknown; totalAfter?: number; avgCostAfter?: number }>([
    { $match: { tenantId: tid, createdAt: { $lte: date }, totalAfter: { $ne: null } } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: "$productId", totalAfter: { $first: "$totalAfter" }, avgCostAfter: { $first: "$avgCostAfter" } } },
  ]).session(session ?? null);
  const seen = new Set(last.map(l => String(l._id)));
  let value = last.reduce((t, l) => t + Math.max(0, l.totalAfter ?? 0) * (l.avgCostAfter ?? 0), 0);
  // Articles sans aucun mouvement (stock repris à la création) : quantité et coût actuels.
  const legacy = await ProductModel.find({ tenantId: tid, isService: { $ne: true }, stockQty: { $gt: 0 }, createdAt: { $lte: date } })
    .select("_id stockQty purchaseCost").session(session ?? null).lean<Array<{ _id: unknown; stockQty: number; purchaseCost?: number }>>();
  for (const p of legacy) if (!seen.has(String(p._id))) value += p.stockQty * (p.purchaseCost ?? 0);
  return Math.round(value);
}

/** Solde du compte de stock (31…) au bilan, à la date. */
export async function stockLedgerBalance(tenantId: string, date: Date, session?: ClientSession) {
  const [r] = await AccountingEntryModel.aggregate<{ balance: number }>([
    { $match: { tenantId: new Types.ObjectId(tenantId), entryDate: { $lte: date } } },
    { $unwind: "$lines" },
    { $match: { "lines.accountCode": { $regex: "^31" } } },
    { $group: { _id: null, balance: { $sum: { $subtract: ["$lines.debit", "$lines.credit"] } } } },
  ]).session(session ?? null);
  return Math.round(r?.balance ?? 0);
}

export async function previewStockVariation(tenantId: string, date: Date, session?: ClientSession) {
  const [stockValue, ledgerBalance] = await Promise.all([stockValueAt(tenantId, date, session), stockLedgerBalance(tenantId, date, session)]);
  const reference = `VAR-STOCK-${date.toISOString().slice(0, 10)}`;
  const already = await AccountingEntryModel.exists({ tenantId, reference, reversedBy: { $exists: false } }).session(session ?? null);
  return { date, stockValue, ledgerBalance, variation: stockValue - ledgerBalance, reference, alreadyPosted: Boolean(already) };
}

export async function postStockVariation(actor: { tenantId: string; userId: string }, date: Date, session?: ClientSession) {
  const p = await previewStockVariation(actor.tenantId, date, session);
  if (p.alreadyPosted) throw new BusinessRuleError(`La variation de stock du ${date.toLocaleDateString("fr-FR")} est déjà passée : extournez-la pour la refaire.`);
  if (p.variation === 0) throw new BusinessRuleError("Aucune variation : la valeur du stock égale déjà le solde du compte 31.");
  const amt = Math.abs(p.variation);
  const lines = p.variation > 0
    ? [{ ...STOCK_ACCOUNT, debit: amt, credit: 0 }, { ...VARIATION_ACCOUNT, debit: 0, credit: amt }]
    : [{ ...VARIATION_ACCOUNT, debit: amt, credit: 0 }, { ...STOCK_ACCOUNT, debit: 0, credit: amt }];
  const [entry] = await AccountingEntryModel.create([{
    tenantId: actor.tenantId, journalCode: "OD", entryDate: date, reference: p.reference,
    label: `Variation de stock au ${date.toLocaleDateString("fr-FR")} (stock final ${p.stockValue.toLocaleString("fr-FR")} FCFA)`,
    lines, linkedDocType: "inventory", createdBy: actor.userId,
  }], { session });
  return { ...p, entryId: entry._id };
}
