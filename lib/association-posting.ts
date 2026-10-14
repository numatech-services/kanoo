import type { ClientSession } from "mongoose";
import type { TokenPayload } from "@/lib/auth";
import { postCashFlow, reverseCashFlow } from "@/lib/cash-posting";
import { BusinessRuleError } from "@/lib/errors";

/**
 * Cotisations et dons : recettes de l'association, enregistrées en trésorerie
 * et en comptabilité à l'encaissement (756 cotisations, 7581 dons), au lieu de
 * rester dans un registre que ni le compte de résultat ni la caisse ne voyaient.
 */

type Posted = { _id: unknown; entryId?: unknown; movementId?: unknown; treasuryAccountId?: unknown; save: (o?: { session?: ClientSession }) => Promise<unknown> };

export async function postMembership(auth: TokenPayload, m: Posted & { amount: number; year: number; receiptNumber: string; paidAt?: Date; memberId: unknown }, session?: ClientSession) {
  if (m.entryId || !m.paidAt) return;
  if (!m.treasuryAccountId) throw new BusinessRuleError("Choisissez le compte (caisse, banque, mobile money) qui a reçu la cotisation.");
  const r = await postCashFlow({
    tenantId: auth.tenantId, userId: auth.userId, treasuryAccountId: m.treasuryAccountId, direction: "in",
    amount: m.amount, date: m.paidAt, label: `Cotisation ${m.year} — reçu ${m.receiptNumber}`, reference: m.receiptNumber,
    account: { accountCode: "756000", accountLabel: "Cotisations des membres" },
    linkedDocType: "membership", linkedDocId: m._id,
  }, session);
  m.entryId = r.entryId; m.movementId = r.movementId;
  await m.save({ session });
}

export async function postDonation(auth: TokenPayload, d: Posted & { amount: number; amountXOF?: number; currency?: string; date: Date; receiptNumber: string; donorName?: string }, session?: ClientSession) {
  if (d.entryId) return;
  if (!d.treasuryAccountId) throw new BusinessRuleError("Choisissez le compte (caisse, banque, mobile money) qui a reçu le don.");
  const fcfa = !d.currency || d.currency === "XOF" ? d.amount : d.amountXOF;
  if (!(Number(fcfa) > 0)) throw new BusinessRuleError("Don en devise : indiquez le montant effectivement reçu en FCFA.");
  const r = await postCashFlow({
    tenantId: auth.tenantId, userId: auth.userId, treasuryAccountId: d.treasuryAccountId, direction: "in",
    amount: Number(fcfa), date: d.date, label: `Don ${d.donorName ? `de ${d.donorName} ` : ""}— reçu ${d.receiptNumber}`, reference: d.receiptNumber,
    account: { accountCode: "758100", accountLabel: "Dons et libéralités reçus" },
    linkedDocType: "donation", linkedDocId: d._id,
  }, session);
  d.entryId = r.entryId; d.movementId = r.movementId;
  await d.save({ session });
}

/** Annulation (cotisation remise à « non payée », suppression) : extourne, jamais d'effacement. */
export async function unpost(auth: TokenPayload, doc: Posted, reason: string, session?: ClientSession) {
  if (!doc.entryId && !doc.movementId) return;
  await reverseCashFlow({ tenantId: auth.tenantId, userId: auth.userId, entryId: doc.entryId, movementId: doc.movementId, reason }, session);
  doc.entryId = undefined; doc.movementId = undefined;
}
