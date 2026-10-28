import { Types, type ClientSession } from "mongoose";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { TreasuryMovementModel } from "@/models/TreasuryMovement";
import { SupplierModel } from "@/models/Supplier";
import { accountBalance, treasuryLedger } from "@/lib/treasury";
import { reverseEntry } from "@/lib/accounting-reversal";
import { checkImputations, pickImputation } from "@/lib/imputation";
import { defaultAccountLabel } from "@/lib/syscohada";
import type { TokenPayload } from "@/lib/auth";
import { BusinessRuleError } from "@/lib/errors";

import { CommandeModel } from "@/models/Commande";
import { registerLedgerAccount } from "@/lib/treasury";
import { EXCHANGE_GAIN, EXCHANGE_LOSS, MAX_EXCHANGE_RATE } from "@/lib/payments";
/** Refus métier : rendu en 400 avec son message, même levé au fond d'une transaction. */
export class PurchaseError extends BusinessRuleError {}

export const SUPPLIER_ACCOUNT = { accountCode: "401100", accountLabel: "Fournisseurs" };
export const VAT_ACCOUNT = { accountCode: "445200", accountLabel: "TVA récupérable sur achats" };

export interface PurchaseLineIn {
  description?: unknown; accountCode?: unknown; accountLabel?: unknown; quantity?: unknown; unitPrice?: unknown;
  amountHT?: unknown; tvaRate?: unknown; projectId?: unknown; activityId?: unknown; costCenter?: unknown;
}

/**
 * Lignes d'achat recalculées côté serveur : montant HT (quantité × prix, ou
 * montant saisi), TVA, compte de charge (classe 6) ou d'immobilisation
 * (classe 2), imputation analytique validée.
 */
export async function buildPurchaseLines(tenantId: string, raw: unknown, defaults: { projectId?: unknown; activityId?: unknown; costCenter?: unknown } = {}) {
  if (!Array.isArray(raw) || raw.length === 0) throw new PurchaseError("Au moins une ligne de dépense.");
  const lines = (raw as PurchaseLineIn[]).map((l, i) => {
    const description = String(l.description ?? "").trim().slice(0, 300);
    if (!description) throw new PurchaseError(`Ligne ${i + 1} : libellé obligatoire.`);
    const accountCode = String(l.accountCode ?? "").trim();
    if (!/^[26]\d{2,7}$/.test(accountCode)) throw new PurchaseError(`Ligne ${i + 1} : compte de charge (6…) ou d'immobilisation (2…) attendu.`);
    const quantity = l.quantity === undefined || l.quantity === "" ? 1 : Number(l.quantity);
    const unitPrice = Number(l.unitPrice);
    let amountHT = l.amountHT !== undefined && l.amountHT !== "" ? Number(l.amountHT) : Math.round(quantity * unitPrice);
    if (!(quantity > 0)) throw new PurchaseError(`Ligne ${i + 1} : quantité invalide.`);
    if (!Number.isFinite(amountHT) || amountHT <= 0) throw new PurchaseError(`Ligne ${i + 1} : montant invalide.`);
    amountHT = Math.round(amountHT);
    const tvaRate = l.tvaRate === undefined || l.tvaRate === "" || l.tvaRate === null ? 0 : Number(l.tvaRate);
    if (!(tvaRate >= 0 && tvaRate < 1)) throw new PurchaseError(`Ligne ${i + 1} : taux de TVA invalide.`);
    const imp = pickImputation({
      projectId: l.projectId ?? defaults.projectId, activityId: l.activityId ?? defaults.activityId, costCenter: l.costCenter ?? defaults.costCenter,
    });
    return {
      description, accountCode,
      accountLabel: String(l.accountLabel ?? "").trim().slice(0, 120) || defaultAccountLabel(accountCode) || "Charges",
      quantity, unitPrice: Number.isFinite(unitPrice) ? unitPrice : Math.round(amountHT / quantity),
      amountHT, tvaRate, amountTVA: Math.round(amountHT * tvaRate), ...imp,
    };
  });
  const err = await checkImputations(tenantId, lines);
  if (err) throw new PurchaseError(err);
  const totalHT = lines.reduce((s, l) => s + l.amountHT, 0);
  const totalTVA = lines.reduce((s, l) => s + l.amountTVA, 0);
  return { lines, totalHT, totalTVA, totalTTC: totalHT + totalTVA };
}

export async function checkSupplier(tenantId: string, supplierId: unknown) {
  if (!supplierId) return null;
  if (!Types.ObjectId.isValid(String(supplierId))) throw new PurchaseError("Fournisseur invalide.");
  const s = await SupplierModel.findOne({ _id: supplierId, tenantId }).select("name").lean<{ _id: unknown; name: string } | null>();
  if (!s) throw new PurchaseError("Fournisseur introuvable.");
  return s;
}

type PurchaseDoc = {
  _id: Types.ObjectId; number: string; kind: string; supplierId?: unknown; payee?: string; supplierRef?: string;
  date: Date; totalHT?: number; totalTTC: number; totalTVA: number; paidAmount: number; status: string; entryId?: unknown;
  commandeId?: unknown; matchOverride?: { by: unknown; at: Date; gapHT: number };
  lines: Array<{ description: string; accountCode: string; accountLabel?: string; amountHT: number; projectId?: unknown; activityId?: unknown; costCenter?: string }>;
  payments: Array<{ _id: Types.ObjectId; date: Date; amount: number; exchangeDifference?: number; treasuryAccountId: unknown; reference?: string; entryId?: unknown; movementId?: unknown; cancelledAt?: Date }>;
  validatedBy?: unknown; validatedAt?: Date; cancelledAt?: Date; cancelReason?: string;
  save: (o?: { session?: ClientSession }) => Promise<unknown>;
  markModified: (p: string) => void;
};

function label(p: PurchaseDoc) {
  const who = p.payee || "fournisseur";
  return `${p.kind === "cash" ? "Dépense" : "Facture"} ${p.supplierRef ? p.supplierRef + " " : ""}— ${who}`.slice(0, 280);
}

/** Validation : écriture d'achat (AC) — charges imputées + TVA / dette fournisseur. */
/**
 * Rapprochement commande / réception / facture d'un achat lié à un bon de
 * commande : montants HT commandé, reçu (quantités réceptionnées) et facturé.
 */
export async function commandeMatch(tenantId: string, p: { commandeId?: unknown; totalHT?: number; lines: Array<{ amountHT: number }> }, session?: ClientSession) {
  if (!p.commandeId) return null;
  const cmd = await CommandeModel.findOne({ _id: p.commandeId, tenantId }).select("number lines").session(session ?? null)
    .lean<{ number: string; lines: Array<{ quantity?: number; receivedQty?: number; unitPrice?: number }> } | null>();
  if (!cmd) return null;
  const orderedHT = Math.round(cmd.lines.reduce((t, l) => t + (l.quantity ?? 0) * (l.unitPrice ?? 0), 0));
  const receivedHT = Math.round(cmd.lines.reduce((t, l) => t + (l.receivedQty ?? 0) * (l.unitPrice ?? 0), 0));
  const invoicedHT = Math.round(p.totalHT ?? p.lines.reduce((t, l) => t + l.amountHT, 0));
  // Tolérance d'arrondi : 1 % du reçu, au moins 100 FCFA.
  const tolerance = Math.max(100, Math.round(receivedHT * 0.01));
  return { commandeNumber: cmd.number, orderedHT, receivedHT, invoicedHT, gapHT: invoicedHT - receivedHT, overInvoiced: invoicedHT > receivedHT + tolerance };
}

export async function validatePurchase(auth: TokenPayload, p: PurchaseDoc, session?: ClientSession, opts: { force?: boolean } = {}) {
  if (p.status !== "draft") throw new PurchaseError("Seul un brouillon se valide.");
  // Une facture fournisseur ne se valide pas pour plus que ce qui a été reçu,
  // sauf décision explicite (tracée) : c'est l'écart qu'un contrôle interne
  // doit voir avant de payer.
  const match = await commandeMatch(auth.tenantId, p, session);
  if (match?.overInvoiced) {
    if (!opts.force) {
      throw new PurchaseError(`Facture (${match.invoicedHT.toLocaleString("fr-FR")} FCFA HT) supérieure à la marchandise reçue `
        + `(${match.receivedHT.toLocaleString("fr-FR")} FCFA HT) sur le bon ${match.commandeNumber}. Enregistrez la réception, ou validez malgré l'écart.`);
    }
    p.matchOverride = { by: auth.userId, at: new Date(), gapHT: match.gapHT };
  }
  const lines = [
    ...p.lines.map(l => ({
      accountCode: l.accountCode, accountLabel: l.accountLabel || l.description, debit: l.amountHT, credit: 0,
      ...(l.projectId ? { projectId: l.projectId } : {}), ...(l.activityId ? { activityId: l.activityId } : {}), ...(l.costCenter ? { costCenter: l.costCenter } : {}),
    })),
    ...(p.totalTVA > 0 ? [{ ...VAT_ACCOUNT, debit: p.totalTVA, credit: 0 }] : []),
    { ...SUPPLIER_ACCOUNT, debit: 0, credit: p.totalTTC, ...(p.supplierId ? { thirdPartyId: p.supplierId } : {}) },
  ];
  const [entry] = await AccountingEntryModel.create([{
    tenantId: auth.tenantId, journalCode: "AC", entryDate: p.date, reference: p.number,
    label: label(p), lines, linkedDocType: "supplier_invoice", linkedDocId: p._id, createdBy: auth.userId,
  }], { session });
  p.entryId = entry._id;
  p.status = "validated";
  p.validatedBy = auth.userId;
  p.validatedAt = new Date();
  await p.save({ session });
}

/** Règlement (total ou partiel) : 401 soldé par la trésorerie + mouvement. */
export async function payPurchase(
  auth: TokenPayload, p: PurchaseDoc,
  input: { amount?: unknown; date?: unknown; treasuryAccountId?: unknown; reference?: unknown; allowOverdraft?: boolean; exchangeDifference?: unknown },
  session?: ClientSession,
) {
  if (!["validated", "partial"].includes(p.status)) throw new PurchaseError(p.status === "draft" ? "Validez d'abord l'achat." : "Cet achat ne peut plus être réglé.");
  const rest = p.totalTTC - p.paidAmount;
  const amount = input.amount === undefined || input.amount === "" ? rest : Math.round(Number(input.amount));
  if (!(amount > 0)) throw new PurchaseError("Montant du règlement invalide.");
  // Règlement en devise : la dette soldée (amount + écart) diffère du décaissé ;
  // écart > 0 : on a payé moins que dû, gain de change ; < 0 : perte.
  const fx = Math.round(Number(input.exchangeDifference) || 0);
  if (Math.abs(fx) > Math.round(rest * MAX_EXCHANGE_RATE)) throw new PurchaseError(`Écart de change trop élevé (au plus ${Math.round(MAX_EXCHANGE_RATE * 100)} % du reste à payer).`);
  const settled = amount + fx;
  if (settled > rest) throw new PurchaseError(`Le règlement dépasse le reste à payer (${rest.toLocaleString("fr-FR")} FCFA).`);
  if (!(settled > 0)) throw new PurchaseError("Montant soldé invalide.");
  const accountId = input.treasuryAccountId;
  if (!accountId || !Types.ObjectId.isValid(String(accountId))) throw new PurchaseError("Choisissez le compte de trésorerie qui paie.");
  const ledger = await treasuryLedger(auth.tenantId, accountId, session);
  if (!ledger) throw new PurchaseError("Compte de trésorerie introuvable.");
  if (!input.allowOverdraft) {
    const bal = await accountBalance(auth.tenantId, String(accountId), session);
    if (bal && bal.balance < amount) throw new PurchaseError(`Solde insuffisant sur ce compte (${bal.balance.toLocaleString("fr-FR")} FCFA).`);
  }
  const date = input.date ? new Date(String(input.date)) : new Date();
  if (isNaN(date.getTime())) throw new PurchaseError("Date de règlement invalide.");
  // Un règlement se constate : jamais à une date à venir (trésorerie et
  // rapprochement faussés d'ici là). Les paiements prévus passent par l'échéancier.
  const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
  if (date > endOfToday) throw new PurchaseError("Date de règlement dans le futur : enregistrez le règlement le jour où il est fait.");
  const reference = input.reference ? String(input.reference).slice(0, 80) : undefined;

  const paymentId = new Types.ObjectId();
  const [entry] = await AccountingEntryModel.create([{
    tenantId: auth.tenantId, journalCode: ledger.journalCode, entryDate: date, reference: `${p.number}-RGL`,
    label: `Règlement ${label(p)}`,
    lines: [
      { ...SUPPLIER_ACCOUNT, debit: settled, credit: 0, ...(p.supplierId ? { thirdPartyId: p.supplierId } : {}) },
      ...(fx < 0 ? [{ ...EXCHANGE_LOSS, debit: -fx, credit: 0 }] : []),
      { accountCode: ledger.accountCode, accountLabel: ledger.accountLabel, debit: 0, credit: amount },
      ...(fx > 0 ? [{ ...EXCHANGE_GAIN, debit: 0, credit: fx }] : []),
    ],
    linkedDocType: "supplier_payment", linkedDocId: p._id, createdBy: auth.userId,
  }], { session });
  const [movement] = await TreasuryMovementModel.create([{
    tenantId: auth.tenantId, accountId, date, amount: -amount, label: `Règlement ${p.number}${p.payee ? ` — ${p.payee}` : ""}`,
    reference, source: "expense", linkedDocType: "purchase", linkedDocId: p._id, createdBy: auth.userId,
  }], { session });
  if (fx) await registerLedgerAccount(auth.tenantId, (fx > 0 ? EXCHANGE_GAIN : EXCHANGE_LOSS).accountCode, (fx > 0 ? EXCHANGE_GAIN : EXCHANGE_LOSS).accountLabel, session);
  p.payments.push({ _id: paymentId, date, amount, exchangeDifference: fx, treasuryAccountId: accountId, reference, entryId: entry._id, movementId: movement._id } as PurchaseDoc["payments"][number]);
  p.paidAmount += settled;
  p.status = p.paidAmount >= p.totalTTC ? "paid" : "partial";
  p.markModified("payments");
  await p.save({ session });
  return { amount, paymentId };
}

/** Annule un règlement : extourne de l'écriture et mouvement inverse. */
export async function cancelPayment(auth: TokenPayload, p: PurchaseDoc, paymentId: string, session?: ClientSession) {
  const pay = p.payments.find(x => String(x._id) === paymentId);
  if (!pay) throw new PurchaseError("Règlement introuvable.");
  if (pay.cancelledAt) throw new PurchaseError("Règlement déjà annulé.");
  if (pay.entryId) await reverseEntry({ tenantId: auth.tenantId, userId: auth.userId, entryId: pay.entryId, reason: "règlement annulé" }, session);
  await TreasuryMovementModel.create([{
    tenantId: auth.tenantId, accountId: pay.treasuryAccountId, date: new Date(), amount: pay.amount,
    label: `Annulation règlement ${p.number}`, source: "expense", linkedDocType: "purchase", linkedDocId: p._id, createdBy: auth.userId,
  }], { session });
  pay.cancelledAt = new Date();
  p.paidAmount -= pay.amount + (pay.exchangeDifference || 0);
  p.status = p.paidAmount > 0 ? "partial" : "validated";
  p.markModified("payments");
  await p.save({ session });
}

/** Annulation d'un achat validé (sans règlement actif) : extourne de l'écriture d'achat. */
export async function cancelPurchase(auth: TokenPayload, p: PurchaseDoc, reason: string, session?: ClientSession) {
  if (p.status === "cancelled") throw new PurchaseError("Achat déjà annulé.");
  if (p.paidAmount > 0) throw new PurchaseError("Annulez d'abord les règlements de cet achat.");
  if (p.entryId) await reverseEntry({ tenantId: auth.tenantId, userId: auth.userId, entryId: p.entryId, reason: reason || "achat annulé" }, session);
  p.status = "cancelled";
  p.cancelledAt = new Date();
  p.cancelReason = reason.slice(0, 300);
  await p.save({ session });
}
