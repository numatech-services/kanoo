import { Types, type ClientSession } from "mongoose";
import { ContractModel } from "@/models/Contract";
import { InvoiceModel } from "@/models/Invoice";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { TreasuryMovementModel } from "@/models/TreasuryMovement";
import { treasuryLedger, registerLedgerAccount } from "@/lib/treasury";
import { reverseEntry } from "@/lib/accounting-reversal";
import { RETENTION_ACCOUNT, retentionState } from "@/lib/retention";
import { BusinessRuleError } from "@/lib/errors";

type Actor = { tenantId: string; userId: string };

/** État de la retenue de garantie d'un marché, lu sur ses factures. */
export async function contractRetention(tenantId: string, contract: Parameters<typeof retentionState>[1] & { _id: unknown }, session?: ClientSession) {
  const invoices = await InvoiceModel.find({ tenantId, contractId: contract._id, documentType: "invoice", retentionAmount: { $gt: 0 } })
    .select("number retentionAmount status issueDate").session(session ?? null)
    .lean<Array<{ _id: unknown; number: string; retentionAmount: number; status: string; issueDate: Date }>>();
  return { ...retentionState(invoices, contract), invoices: invoices.filter(i => i.status !== "cancelled") };
}

/**
 * Le client reverse la retenue (réception définitive, ou caution substituée) :
 * banque au débit, 4117 au crédit, au nom du client ; mouvement de trésorerie.
 */
export async function releaseRetention(actor: Actor, contractId: string, input: { amount?: unknown; date?: unknown; treasuryAccountId?: unknown; reference?: unknown }, session?: ClientSession) {
  const contract = await ContractModel.findOne({ _id: contractId, tenantId: actor.tenantId }).session(session ?? null);
  if (!contract) throw new BusinessRuleError("Marché introuvable.");
  const state = await contractRetention(actor.tenantId, contract.toObject(), session);
  const amount = Math.round(Number(input.amount ?? state.outstanding) || 0);
  if (!(amount > 0)) throw new BusinessRuleError("Montant de la retenue reversée invalide.");
  if (amount > state.outstanding) throw new BusinessRuleError(`Il ne reste que ${state.outstanding.toLocaleString("fr-FR")} FCFA de retenue à récupérer sur ce marché.`);
  const date = input.date ? new Date(String(input.date)) : new Date();
  if (isNaN(date.getTime())) throw new BusinessRuleError("Date invalide.");
  if (!Types.ObjectId.isValid(String(input.treasuryAccountId ?? ""))) throw new BusinessRuleError("Choisissez le compte qui reçoit la retenue.");
  const ledger = await treasuryLedger(actor.tenantId, input.treasuryAccountId, session);
  if (!ledger) throw new BusinessRuleError("Compte de trésorerie introuvable.");
  await registerLedgerAccount(actor.tenantId, RETENTION_ACCOUNT.accountCode, RETENTION_ACCOUNT.accountLabel, session);

  const reference = String(input.reference ?? "").trim().slice(0, 80) || `RG-${contract.reference}`;
  const label = `Retenue de garantie reversée — marché ${contract.reference}`;
  const [entry] = await AccountingEntryModel.create([{
    tenantId: actor.tenantId, journalCode: ledger.journalCode, entryDate: date, reference, label,
    lines: [
      { accountCode: ledger.accountCode, accountLabel: ledger.accountLabel, debit: amount, credit: 0 },
      { ...RETENTION_ACCOUNT, debit: 0, credit: amount, thirdPartyId: contract.clientId },
    ],
    linkedDocType: "retention", linkedDocId: contract._id, createdBy: actor.userId,
  }], { session });
  await TreasuryMovementModel.create([{
    tenantId: actor.tenantId, accountId: input.treasuryAccountId, date, amount, label, reference,
    source: "payment", linkedDocType: "contract", linkedDocId: contract._id, createdBy: actor.userId,
  }], { session });
  contract.retentionReleases.push({ date, amount, treasuryAccountId: input.treasuryAccountId, entryId: entry._id, reference, createdBy: actor.userId });
  if (!contract.receptionDefinitiveDate && amount === state.outstanding) contract.receptionDefinitiveDate = date;
  await contract.save({ session });
  return { amount, outstanding: state.outstanding - amount, entryId: entry._id };
}

/** Annule un reversement saisi par erreur : écriture extournée, mouvement contre-passé. */
export async function cancelRetentionRelease(actor: Actor, contractId: string, releaseId: string, reason: string, session?: ClientSession) {
  const contract = await ContractModel.findOne({ _id: contractId, tenantId: actor.tenantId }).session(session ?? null);
  if (!contract) throw new BusinessRuleError("Marché introuvable.");
  const release = (contract.retentionReleases as Array<{ _id: unknown; amount: number; date: Date; treasuryAccountId?: unknown; entryId?: unknown; reference?: string }>)
    .find(r => String(r._id) === releaseId);
  if (!release) throw new BusinessRuleError("Reversement introuvable.");
  if (release.entryId) await reverseEntry({ tenantId: actor.tenantId, userId: actor.userId, entryId: release.entryId, reason: `reversement de retenue annulé : ${reason}` }, session);
  if (release.treasuryAccountId) {
    await TreasuryMovementModel.create([{
      tenantId: actor.tenantId, accountId: release.treasuryAccountId, date: new Date(), amount: -release.amount,
      label: `Annulation — retenue de garantie reversée (${contract.reference})`, reference: release.reference,
      source: "payment", linkedDocType: "contract", linkedDocId: contract._id, createdBy: actor.userId,
    }], { session });
  }
  contract.retentionReleases.pull({ _id: release._id });
  await contract.save({ session });
  return { amount: release.amount };
}
