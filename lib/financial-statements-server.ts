import { Types } from "mongoose";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { TenantModel } from "@/models/Tenant";
import { trialBalance } from "@/lib/accounting-reports";
import { syscohadaBalanceSheet, syscohadaIncomeStatement, syscohadaCashFlow, type AccountAmounts } from "@/lib/financial-statements";

/**
 * Lecture des écritures pour les états financiers d'un exercice (année civile).
 *
 * Soldes de bilan : cumul depuis l'origine, ou depuis le 1er janvier qui suit
 * le dernier exercice clôturé (les à-nouveaux reprennent alors l'historique).
 * Mouvements de l'exercice : toutes les écritures datées de l'exercice SAUF
 * les à-nouveaux (journal AN, y compris la reprise des soldes d'ouverture),
 * qui ne sont pas des flux.
 */
async function closedYears(tenantId: string): Promise<number[]> {
  const t = await TenantModel.findById(tenantId).select("closedFiscalYears").lean<{ closedFiscalYears?: number[] } | null>();
  return t?.closedFiscalYears ?? [];
}

/** Début du cumul des soldes pour un bilan arrêté dans l'année `year`. */
function cumulStart(year: number, closed: number[]): Date | undefined {
  const last = Math.max(-Infinity, ...closed.filter(y => y < year));
  return Number.isFinite(last) ? new Date(last + 1, 0, 1) : undefined;
}

async function balances(tenantId: string, from: Date | undefined, to: Date): Promise<AccountAmounts[]> {
  return (await trialBalance(tenantId, from, to)).map(r => ({ code: r.code, label: r.label, debit: r.debit, credit: r.credit }));
}

/** Mouvements par compte, journal AN exclu. */
async function movements(tenantId: string, from: Date, to: Date): Promise<AccountAmounts[]> {
  const rows = await AccountingEntryModel.aggregate<{ _id: string; label: string; debit: number; credit: number }>([
    { $match: { tenantId: new Types.ObjectId(tenantId), entryDate: { $gte: from, $lte: to }, journalCode: { $ne: "AN" } } },
    { $unwind: "$lines" },
    { $group: { _id: "$lines.accountCode", label: { $first: "$lines.accountLabel" }, debit: { $sum: "$lines.debit" }, credit: { $sum: "$lines.credit" } } },
    { $sort: { _id: 1 } },
  ]);
  return rows.map(r => ({ code: r._id, label: r.label, debit: r.debit, credit: r.credit }));
}

/** Trésorerie (classe 5) d'ouverture de l'exercice : à-nouveaux de l'année, plus l'historique si l'exercice précédent n'est pas clôturé. */
async function openingCash(tenantId: string, year: number, closed: number[], to: Date): Promise<number> {
  const tid = new Types.ObjectId(tenantId);
  const jan1 = new Date(year, 0, 1);
  const cash = { "lines.accountCode": { $regex: "^5" } };
  const sum = async (match: Record<string, unknown>) => {
    const [r] = await AccountingEntryModel.aggregate<{ s: number }>([
      { $match: { tenantId: tid, ...match } }, { $unwind: "$lines" }, { $match: cash },
      { $group: { _id: null, s: { $sum: { $subtract: ["$lines.debit", "$lines.credit"] } } } },
    ]);
    return r?.s ?? 0;
  };
  const start = cumulStart(year, closed);
  const before = start && start >= jan1 ? 0 : await sum({ entryDate: { $lt: jan1, ...(start ? { $gte: start } : {}) } });
  const an = await sum({ entryDate: { $gte: jan1, $lte: to }, journalCode: "AN" });
  return before + an;
}

/** États financiers de l'exercice `year`, arrêtés au 31 décembre (ou à `asOf` pour l'exercice en cours), avec l'exercice N-1. */
export async function financialStatements(tenantId: string, year: number, asOf?: Date) {
  const closed = await closedYears(tenantId);
  const jan1 = new Date(year, 0, 1);
  const end = asOf && asOf < new Date(year, 11, 31, 23, 59, 59) ? asOf : new Date(year, 11, 31, 23, 59, 59);
  const prevEnd = new Date(year - 1, 11, 31, 23, 59, 59);
  const [bsRows, bsPrevRows, moves, plPrevRows, cash0] = await Promise.all([
    balances(tenantId, cumulStart(year, closed), end),
    balances(tenantId, cumulStart(year - 1, closed), prevEnd),
    movements(tenantId, jan1, end),
    movements(tenantId, new Date(year - 1, 0, 1), prevEnd),
    openingCash(tenantId, year, closed, end),
  ]);
  const plRows = moves;
  const incomeStatement = syscohadaIncomeStatement(plRows.filter(r => /^[678]/.test(r.code)));
  const incomeStatementPrev = syscohadaIncomeStatement(plPrevRows.filter(r => /^[678]/.test(r.code)));
  return {
    year, asOf: end, closed: closed.includes(year),
    balanceSheet: syscohadaBalanceSheet(bsRows, { currentYearResult: incomeStatement.resultat + incomeStatement.unclassified }),
    balanceSheetPrev: syscohadaBalanceSheet(bsPrevRows, { currentYearResult: incomeStatementPrev.resultat + incomeStatementPrev.unclassified }),
    incomeStatement, incomeStatementPrev,
    cashFlow: syscohadaCashFlow(moves, cash0),
    /** Pour les notes annexes. */
    balances: bsRows, balancesPrev: bsPrevRows, movements: moves,
  };
}
export type FinancialStatements = Awaited<ReturnType<typeof financialStatements>>;
