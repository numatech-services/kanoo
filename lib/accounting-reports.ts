import { Types } from "mongoose";
import { AccountingEntryModel } from "@/models/AccountingEntry";

export interface BalanceRow { code: string; label: string; debit: number; credit: number; soldeDebit: number; soldeCredit: number }

function dateMatch(from?: Date, to?: Date) {
  const m: Record<string, Date> = {};
  if (from) m.$gte = from;
  if (to) m.$lte = to;
  return Object.keys(m).length ? { entryDate: m } : {};
}

/** Balance générale : totaux et soldes par compte sur la période. */
export async function trialBalance(tenantId: string, from?: Date, to?: Date, prefix?: string): Promise<BalanceRow[]> {
  const rows = await AccountingEntryModel.aggregate<{ _id: string; label: string; debit: number; credit: number }>([
    { $match: { tenantId: new Types.ObjectId(tenantId), ...dateMatch(from, to) } },
    { $unwind: "$lines" },
    ...(prefix ? [{ $match: { "lines.accountCode": { $regex: `^${prefix}` } } }] : []),
    { $group: { _id: "$lines.accountCode", label: { $first: "$lines.accountLabel" }, debit: { $sum: "$lines.debit" }, credit: { $sum: "$lines.credit" } } },
    { $sort: { _id: 1 } },
  ]);
  return rows.map(r => {
    const s = r.debit - r.credit;
    return { code: r._id, label: r.label, debit: r.debit, credit: r.credit, soldeDebit: Math.max(0, s), soldeCredit: Math.max(0, -s) };
  });
}

/** Grand livre d'un compte (ou d'une racine) : solde d'ouverture, mouvements, solde progressif. */
export async function generalLedger(tenantId: string, prefix: string, from?: Date, to?: Date) {
  const tid = new Types.ObjectId(tenantId);
  const acc = { "lines.accountCode": { $regex: `^${prefix}` } };
  const [opening] = from ? await AccountingEntryModel.aggregate<{ debit: number; credit: number }>([
    { $match: { tenantId: tid, entryDate: { $lt: from } } }, { $unwind: "$lines" }, { $match: acc },
    { $group: { _id: null, debit: { $sum: "$lines.debit" }, credit: { $sum: "$lines.credit" } } },
  ]) : [];
  const moves = await AccountingEntryModel.aggregate<{ _id: unknown; entryDate: Date; journalCode: string; reference: string; label: string; line: { accountCode: string; accountLabel: string; debit: number; credit: number } }>([
    { $match: { tenantId: tid, ...dateMatch(from, to) } }, { $unwind: "$lines" }, { $match: acc },
    { $project: { entryDate: 1, journalCode: 1, reference: 1, label: 1, line: "$lines" } },
    // Plus de coupure à 5 000 lignes : le grand livre s'arrêtait sans le dire,
    // solde de clôture faux compris.
    { $sort: { entryDate: 1, _id: 1 } },
  ]).allowDiskUse(true);
  let running = (opening?.debit ?? 0) - (opening?.credit ?? 0);
  const openingBalance = running;
  const lines = moves.map(m => {
    running += m.line.debit - m.line.credit;
    return { entryId: String(m._id), date: m.entryDate, journal: m.journalCode, reference: m.reference, label: m.label,
      account: m.line.accountCode, accountLabel: m.line.accountLabel, debit: m.line.debit, credit: m.line.credit, balance: running };
  });
  return { openingBalance, lines, closingBalance: running,
    totalDebit: lines.reduce((s, l) => s + l.debit, 0), totalCredit: lines.reduce((s, l) => s + l.credit, 0) };
}

const PL_GROUPS: Array<{ key: string; label: string; side: "charge" | "produit"; prefixes: string[] }> = [
  { key: "ventes", label: "Ventes de marchandises et produits", side: "produit", prefixes: ["701", "702", "707"] },
  { key: "services", label: "Travaux, services vendus", side: "produit", prefixes: ["705", "706"] },
  { key: "autres_produits", label: "Autres produits", side: "produit", prefixes: ["70", "71", "72", "73", "74", "75", "76", "77", "78", "79"] },
  { key: "achats", label: "Achats consommés", side: "charge", prefixes: ["60"] },
  { key: "transports", label: "Transports", side: "charge", prefixes: ["61"] },
  { key: "services_ext", label: "Services extérieurs", side: "charge", prefixes: ["62", "63"] },
  { key: "impots", label: "Impôts et taxes", side: "charge", prefixes: ["64"] },
  { key: "autres_charges", label: "Autres charges", side: "charge", prefixes: ["65"] },
  { key: "personnel", label: "Charges de personnel", side: "charge", prefixes: ["66"] },
  { key: "financier", label: "Frais financiers", side: "charge", prefixes: ["67"] },
  { key: "dotations", label: "Dotations aux amortissements et provisions", side: "charge", prefixes: ["68", "69"] },
  // Hors activités ordinaires (cessions d'immobilisations…) et impôt sur le résultat.
  { key: "hao_produits", label: "Produits hors activités ordinaires", side: "produit", prefixes: ["82", "84", "86", "88"] },
  { key: "hao_charges", label: "Charges hors activités ordinaires", side: "charge", prefixes: ["81", "83", "85"] },
  { key: "impot_resultat", label: "Impôts sur le résultat et participation", side: "charge", prefixes: ["87", "89"] },
];
/** Classe des comptes de gestion (charges, produits, HAO). */
const isPL = (code: string) => /^[678]/.test(code);
const sideOf = (code: string) => (code[0] === "7" || /^8[2468]/.test(code) ? "produit" : "charge");

/** Compte de résultat (présentation simplifiée SYSCOHADA). */
export async function incomeStatement(tenantId: string, from?: Date, to?: Date) {
  const bal = await trialBalance(tenantId, from, to);
  const groups = PL_GROUPS.map(g => ({ ...g, amount: 0, accounts: [] as Array<{ code: string; label: string; amount: number }> }));
  for (const r of bal) {
    if (!isPL(r.code)) continue;
    // Un compte hors des rubriques (74, 76, 80… saisis à la main ou importés)
    // était ignoré : le résultat ne correspondait plus à la balance. Il va
    // dans la rubrique « autres » de son sens.
    const side = sideOf(r.code);
    const g = groups.find(x => x.prefixes.some(p => r.code.startsWith(p)) && x.side === side)
      ?? groups.find(x => x.key === (r.code[0] === "8" ? (side === "produit" ? "hao_produits" : "hao_charges") : side === "produit" ? "autres_produits" : "autres_charges"))!;
    const amount = g.side === "produit" ? r.credit - r.debit : r.debit - r.credit;
    g.amount += amount;
    g.accounts.push({ code: r.code, label: r.label, amount });
  }
  const produits = groups.filter(g => g.side === "produit").reduce((s, g) => s + g.amount, 0);
  const charges = groups.filter(g => g.side === "charge").reduce((s, g) => s + g.amount, 0);
  return { groups: groups.filter(g => g.amount !== 0 || g.accounts.length), produits, charges, resultat: produits - charges };
}

/**
 * Bilan à une date (cumul depuis l'origine). Les comptes de tiers et de
 * trésorerie vont à l'actif ou au passif selon le sens de leur solde ; le
 * résultat de l'exercice (classes 6-7 non encore soldées) équilibre le passif.
 */
export async function balanceSheet(tenantId: string, at: Date, closedYears: number[] = []) {
  // Après une clôture, les à-nouveaux (1er janvier) reprennent les soldes : on
  // part du dernier exercice ouvert pour ne pas compter deux fois l'historique.
  const lastClosed = Math.max(-Infinity, ...closedYears.filter(y => y < at.getFullYear()));
  const start = Number.isFinite(lastClosed) ? new Date(lastClosed + 1, 0, 1) : undefined;
  const bal = await trialBalance(tenantId, start, at);
  const actif: Array<{ code: string; label: string; amount: number; rubric: string }> = [];
  const passif: Array<{ code: string; label: string; amount: number; rubric: string }> = [];
  let resultat = 0;
  for (const r of bal) {
    const s = r.debit - r.credit;
    const c = r.code[0];
    if (isPL(r.code)) { resultat -= s; continue; }
    if (s === 0) continue;
    if (c === "1") passif.push({ code: r.code, label: r.label, amount: -s, rubric: "Capitaux propres et dettes financières" });
    else if (c === "2") actif.push({ code: r.code, label: r.label, amount: s, rubric: "Actif immobilisé (net)" });
    else if (c === "3") actif.push({ code: r.code, label: r.label, amount: s, rubric: "Stocks" });
    else if (c === "4") (s > 0 ? actif : passif).push({ code: r.code, label: r.label, amount: Math.abs(s), rubric: s > 0 ? "Créances" : "Dettes" });
    else if (c === "5") (s > 0 ? actif : passif).push({ code: r.code, label: r.label, amount: Math.abs(s), rubric: s > 0 ? "Trésorerie – actif" : "Trésorerie – passif" });
  }
  passif.push({ code: "13", label: "Résultat de l'exercice (non affecté)", amount: resultat, rubric: "Capitaux propres et dettes financières" });
  const totalActif = actif.reduce((s, x) => s + x.amount, 0);
  const totalPassif = passif.reduce((s, x) => s + x.amount, 0);
  return { actif, passif, totalActif, totalPassif, resultat };
}
