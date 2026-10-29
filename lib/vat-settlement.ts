import { Types, type ClientSession } from "mongoose";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { TenantModel } from "@/models/Tenant";
import { reverseEntry } from "@/lib/accounting-reversal";
import { registerLedgerAccount } from "@/lib/treasury";
import { balanceFloor } from "@/lib/accounting-reports";
import { isTaxableOperation } from "@/lib/vat";
import { FiscalDeclarationModel } from "@/models/FiscalDeclaration";
import { BusinessRuleError } from "@/lib/errors";

/** TVA due au Trésor après liquidation du mois. */
export const VAT_DUE = { accountCode: "444100", accountLabel: "État, TVA due" };
/** Crédit de TVA à reporter sur les mois suivants. */
export const VAT_CREDIT = { accountCode: "444900", accountLabel: "État, crédit de TVA à reporter" };

type Line = { accountCode: string; accountLabel: string; debit: number; credit: number };

/**
 * Lignes de l'écriture de liquidation d'un mois (calcul pur) :
 *  - chaque compte 443 (TVA collectée) est soldé au débit, chaque compte 445
 *    (TVA déductible) au crédit ;
 *  - TVA nette positive : le crédit reporté des mois précédents s'impute
 *    d'abord (4449 au crédit), le reste est dû (4441 au crédit) ;
 *  - TVA nette négative : elle devient un crédit à reporter (4449 au débit).
 * Montants arrondis au franc ; une ligne nulle n'est pas écrite.
 */
export function vatSettlementLines(balances: Array<{ accountCode: string; accountLabel?: string; net: number }>, creditBroughtForward: number) {
  const lines: Line[] = [];
  let collected = 0, deductible = 0;
  for (const b of balances) {
    const net = Math.round(b.net); // débit − crédit du mois
    if (!net) continue;
    const label = b.accountLabel || (b.accountCode.startsWith("443") ? "TVA collectée" : "TVA déductible");
    if (b.accountCode.startsWith("443")) { collected += -net; lines.push({ accountCode: b.accountCode, accountLabel: label, debit: net < 0 ? -net : 0, credit: net > 0 ? net : 0 }); }
    else if (b.accountCode.startsWith("445")) { deductible += net; lines.push({ accountCode: b.accountCode, accountLabel: label, debit: net < 0 ? -net : 0, credit: net > 0 ? net : 0 }); }
  }
  const net = collected - deductible;
  const available = Math.max(0, Math.round(creditBroughtForward));
  let due = 0, creditUsed = 0, creditCarried = 0;
  if (net > 0) {
    creditUsed = Math.min(available, net);
    due = net - creditUsed;
    if (creditUsed) lines.push({ ...VAT_CREDIT, debit: 0, credit: creditUsed });
    if (due) lines.push({ ...VAT_DUE, debit: 0, credit: due });
  } else if (net < 0) {
    creditCarried = -net;
    lines.push({ ...VAT_CREDIT, debit: creditCarried, credit: 0 });
  }
  return { lines, collected, deductible, net, due, creditUsed, creditCarried: available - creditUsed + creditCarried };
}

const pad = (n: number) => String(n).padStart(2, "0");
export const settlementReference = (annee: number, mois: number) => `LIQ-TVA-${annee}-${pad(mois)}`;
const ACTIVE = { reversedBy: { $exists: false }, reverses: { $exists: false } };

type Bal = Map<string, { accountCode: string; accountLabel?: string; net: number }>;
function add(map: Bal, l: { accountCode: string; accountLabel?: string; debit?: number; credit?: number }) {
  const cur = map.get(l.accountCode) ?? { accountCode: l.accountCode, accountLabel: l.accountLabel, net: 0 };
  cur.net += (l.debit || 0) - (l.credit || 0);
  map.set(l.accountCode, cur);
}

/** Solde du 4449 avant une date (positif = crédit de TVA disponible, négatif = anomalie). */
async function vatCreditBalance(tid: Types.ObjectId, before: Date, session?: ClientSession) {
  const tenant = await TenantModel.findById(tid).select("closedFiscalYears").session(session ?? null).lean<{ closedFiscalYears?: number[] } | null>();
  const floor = balanceFloor(new Date(before.getTime() - 1), tenant?.closedFiscalYears ?? []);
  const [r] = await AccountingEntryModel.aggregate<{ d: number; c: number }>([
    { $match: { tenantId: tid, "lines.accountCode": VAT_CREDIT.accountCode, entryDate: { ...(floor ? { $gte: floor } : {}), $lt: before } } },
    { $unwind: "$lines" },
    { $match: { "lines.accountCode": VAT_CREDIT.accountCode } },
    { $group: { _id: null, d: { $sum: "$lines.debit" }, c: { $sum: "$lines.credit" } } },
  ]).session(session ?? null);
  return Math.round((r?.d ?? 0) - (r?.c ?? 0));
}

/**
 * Passe (ou repasse) l'écriture de liquidation de la TVA d'un mois, datée du
 * dernier jour du mois, au journal OD. Refusée, avec la raison, quand elle
 * risquerait de fausser les comptes :
 *  - TVA du mois déjà soldée en partie hors liquidation (paiement passé
 *    directement au 443, OD de liquidation saisie à la main) : double compte ;
 *  - mois suivant déjà liquidé (une rectification se reprend dans l'ordre) ;
 *  - mois précédent avec de la TVA, non liquidé, alors que la liquidation est
 *    déjà en usage (le crédit reporté serait faux) ;
 *  - 4449 créditeur (crédit imputé plus qu'il n'existait) ;
 *  - période verrouillée.
 * Une liquidation déjà passée pour ce mois est extournée d'abord. La
 * déclaration est touchée dans la même transaction : deux liquidations
 * simultanées entrent en conflit au lieu de s'additionner.
 */
export async function postVatSettlement(actor: { tenantId: string; userId: string }, annee: number, mois: number, opts: { declarationId?: unknown } = {}, session?: ClientSession) {
  const tid = new Types.ObjectId(String(actor.tenantId));
  const start = new Date(annee, mois - 1, 1);
  const end = new Date(annee, mois, 0, 23, 59, 59, 999);
  const reference = settlementReference(annee, mois);
  const refuse = (msg: string) => { throw new BusinessRuleError(msg); };

  if (opts.declarationId) {
    await FiscalDeclarationModel.updateOne({ _id: opts.declarationId, tenantId: tid }, { $inc: { settlementVersion: 1 } }, { session });
  }
  const tenant = await TenantModel.findById(tid).select("accountingLockedUntil").session(session ?? null).lean<{ accountingLockedUntil?: Date } | null>();
  if (tenant?.accountingLockedUntil && new Date(annee, mois, 0) <= new Date(tenant.accountingLockedUntil)) {
    refuse(`Période verrouillée jusqu'au ${new Date(tenant.accountingLockedUntil).toLocaleDateString("fr-FR")} : la liquidation de ${pad(mois)}/${annee} est à passer par le cabinet (écriture de régularisation).`);
  }
  // Mois suivants déjà liquidés : la rectification fausserait leur crédit reporté.
  const later = await AccountingEntryModel.findOne({ tenantId: tid, linkedDocType: "vat_settlement", entryDate: { $gt: end }, ...ACTIVE }).select("reference").session(session ?? null).lean<{ reference: string } | null>();
  if (later) refuse(`Le mois ${later.reference.replace("LIQ-TVA-", "")} est déjà liquidé : rectifier ${pad(mois)}/${annee} fausserait son crédit reporté. Faites reprendre les liquidations dans l'ordre par le cabinet.`);

  // Toutes les écritures du mois qui touchent la TVA (hors à-nouveaux et liquidations Kanoo).
  const entries = await AccountingEntryModel.find({ tenantId: tid, entryDate: { $gte: start, $lte: end }, journalCode: { $ne: "AN" }, "lines.accountCode": { $regex: "^44[35]" } })
    .select("entryDate linkedDocType reverses lines.accountCode lines.accountLabel lines.debit lines.credit").session(session ?? null)
    .lean<Array<{ _id: Types.ObjectId; entryDate: Date; linkedDocType?: string; reverses?: unknown; lines: Array<{ accountCode: string; accountLabel?: string; debit?: number; credit?: number }> }>>();
  const settlementIds = new Set(entries.filter(e => e.linkedDocType === "vat_settlement").map(e => String(e._id)));
  const taxable: Bal = new Map(), other: Bal = new Map();
  for (const e of entries) {
    if (e.linkedDocType === "vat_settlement" || (e.reverses && settlementIds.has(String(e.reverses)))) continue;
    // Reprise d'un crédit antérieur (445 → 4449) passée par le cabinet : ce n'est pas un paiement.
    if (e.lines.some(l => l.accountCode === VAT_CREDIT.accountCode)) continue;
    if (e.linkedDocType === "reversal" && e.reverses) {
      // Extourne d'une liquidation d'un autre mois : sans effet ici.
      const orig = await AccountingEntryModel.findOne({ _id: e.reverses, tenantId: tid }).select("linkedDocType").session(session ?? null).lean<{ linkedDocType?: string } | null>();
      if (orig?.linkedDocType === "vat_settlement") continue;
    }
    for (const l of e.lines) if (/^44[35]/.test(l.accountCode)) add(isTaxableOperation(e.lines) ? taxable : other, l);
  }
  // Ancienne pratique : la TVA du mois précédent payée au 443 (contre la banque ou la caisse)
  // entre le 1er et le 20 du mois, quand ce mois précédent n'a pas été liquidé dans Kanoo.
  // Ce paiement solde la dette d'avant : il n'y a pas de double compte, on l'écarte du contrôle.
  const prevRef = settlementReference(new Date(annee, mois - 2, 1).getFullYear(), new Date(annee, mois - 2, 1).getMonth() + 1);
  const prevLiquidated = await AccountingEntryModel.exists({ tenantId: tid, linkedDocType: "vat_settlement", reference: prevRef, ...ACTIVE }).session(session ?? null);
  if (!prevLiquidated) {
    const legacy = entries.filter(e => !isTaxableOperation(e.lines) && e.lines.every(l => /^(443|5)/.test(l.accountCode))
      && e.lines.some(l => /^443/.test(l.accountCode) && (l.debit || 0) > 0) && new Date((e as unknown as { entryDate: Date }).entryDate).getDate() <= 20);
    for (const e of legacy) for (const l of e.lines) if (/^443/.test(l.accountCode)) {
      const cur = other.get(l.accountCode);
      if (cur) cur.net -= (l.debit || 0) - (l.credit || 0);
    }
  }
  const touched = [...other.values()].filter(b => Math.abs(b.net) >= 1);
  if (touched.length) {
    refuse(`La TVA de ${pad(mois)}/${annee} est déjà soldée en partie hors de Kanoo (${touched.map(b => `${b.accountCode} : ${Math.round(b.net).toLocaleString("fr-FR")}`).join(", ")} — paiement passé directement au 443 ou OD de liquidation saisie à la main) : liquidation non passée pour éviter un double compte. À régulariser par le cabinet.`);
  }
  // Mois précédent : avec de la TVA et non liquidé, alors que la liquidation est en usage → crédit reporté faux.
  const prevStart = new Date(annee, mois - 2, 1), prevEnd = new Date(start.getTime() - 1);
  const inUse = await AccountingEntryModel.exists({ tenantId: tid, linkedDocType: "vat_settlement", entryDate: { $lt: start }, ...ACTIVE }).session(session ?? null);
  if (inUse) {
    const prevSettled = await AccountingEntryModel.exists({ tenantId: tid, linkedDocType: "vat_settlement", reference: settlementReference(prevStart.getFullYear(), prevStart.getMonth() + 1), ...ACTIVE }).session(session ?? null);
    const prevVat = prevSettled ? null : await AccountingEntryModel.exists({ tenantId: tid, entryDate: { $gte: prevStart, $lte: prevEnd }, journalCode: { $ne: "AN" }, "lines.accountCode": { $regex: "^44[35]" }, linkedDocType: { $ne: "vat_settlement" } }).session(session ?? null);
    if (prevVat) refuse(`Le mois ${pad(prevStart.getMonth() + 1)}/${prevStart.getFullYear()} a de la TVA et n'est pas liquidé : liquidez-le d'abord (le crédit reporté en dépend).`);
  }
  const credit = await vatCreditBalance(tid, start, session);
  if (credit < 0) refuse(`Le compte 4449 (crédit de TVA) est créditeur de ${(-credit).toLocaleString("fr-FR")} FCFA avant ${pad(mois)}/${annee} : plus de crédit imputé qu'il n'en existait. À régulariser par le cabinet avant toute nouvelle liquidation.`);

  // Rectification : l'ancienne liquidation du mois est extournée à sa date.
  const previous = await AccountingEntryModel.find({ tenantId: tid, linkedDocType: "vat_settlement", reference, ...ACTIVE }).session(session ?? null);
  for (const e of previous) await reverseEntry({ tenantId: String(tid), userId: actor.userId, entryId: e._id, reason: "liquidation de TVA recalculée", date: e.entryDate }, session);

  const result = vatSettlementLines([...taxable.values()], credit);
  if (!result.lines.length) return { ...result, entryId: null };
  await registerLedgerAccount(String(tid), VAT_DUE.accountCode, VAT_DUE.accountLabel, session);
  await registerLedgerAccount(String(tid), VAT_CREDIT.accountCode, VAT_CREDIT.accountLabel, session);
  const [entry] = await AccountingEntryModel.create([{
    tenantId: tid, journalCode: "OD", entryDate: new Date(annee, mois, 0), reference,
    label: `Liquidation de la TVA de ${pad(mois)}/${annee}`,
    lines: result.lines, linkedDocType: "vat_settlement", ...(opts.declarationId ? { linkedDocId: opts.declarationId } : {}),
    createdBy: actor.userId,
  }], { session });
  return { ...result, entryId: entry._id };
}

/** Crédit de TVA disponible à une date (solde débiteur du 4449). */
export async function vatCreditAt(tenantId: string, before: Date): Promise<number> {
  return Math.max(0, await vatCreditBalance(new Types.ObjectId(String(tenantId)), before));
}

/** TVA due d'un mois liquidé (4441 crédité par sa liquidation) et déjà payée (4441 débité par ses paiements). */
export async function vatDueOf(tenantId: string, annee: number, mois: number, session?: ClientSession) {
  const tid = new Types.ObjectId(String(tenantId));
  const reference = settlementReference(annee, mois);
  const settlement = await AccountingEntryModel.findOne({ tenantId: tid, linkedDocType: "vat_settlement", reference, ...ACTIVE }).select("lines").session(session ?? null)
    .lean<{ lines: Array<{ accountCode: string; debit?: number; credit?: number }> } | null>();
  const due = Math.round((settlement?.lines ?? []).filter(l => l.accountCode === VAT_DUE.accountCode).reduce((t, l) => t + (l.credit || 0) - (l.debit || 0), 0));
  const payments = await AccountingEntryModel.find({ tenantId: tid, linkedDocType: "vat_payment", reference: { $regex: `^PAY-${reference}` }, ...ACTIVE }).select("lines").session(session ?? null)
    .lean<Array<{ lines: Array<{ accountCode: string; debit?: number; credit?: number }> }>>();
  const paid = Math.round(payments.flatMap(p => p.lines).filter(l => l.accountCode === VAT_DUE.accountCode).reduce((t, l) => t + (l.debit || 0) - (l.credit || 0), 0));
  // Dette réelle au 4441 (toutes écritures) : un paiement saisi ailleurs (saisie libre) est reconnu.
  const [b] = await AccountingEntryModel.aggregate<{ d: number; c: number }>([
    { $match: { tenantId: tid, "lines.accountCode": VAT_DUE.accountCode } }, { $unwind: "$lines" }, { $match: { "lines.accountCode": VAT_DUE.accountCode } },
    { $group: { _id: null, d: { $sum: "$lines.debit" }, c: { $sum: "$lines.credit" } } },
  ]).session(session ?? null);
  const open = Math.max(0, Math.round((b?.c ?? 0) - (b?.d ?? 0)));
  // TVA nette de la liquidation (443 soldé moins 445 soldé) : comparée à la déclaration pour repérer une liquidation périmée.
  const settledNet = Math.round((settlement?.lines ?? []).reduce((t, l) => t + (/^443/.test(l.accountCode) ? (l.debit || 0) - (l.credit || 0) : /^445/.test(l.accountCode) ? -((l.credit || 0) - (l.debit || 0)) : 0), 0));
  return { settled: !!settlement, due, paid, remaining: Math.min(open, Math.max(0, due - paid)), settledNet };
}
