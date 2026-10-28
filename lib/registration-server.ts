import { Types, type ClientSession } from "mongoose";
import { ContractModel } from "@/models/Contract";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { TreasuryMovementModel } from "@/models/TreasuryMovement";
import { ClientModel } from "@/models/Client";
import { BusinessRuleError } from "@/lib/errors";
import { treasuryLedger, registerLedgerAccount } from "@/lib/treasury";
import { reverseEntry } from "@/lib/accounting-reversal";
import { assessRegistration, registrationDueDate, receptionStamp, type BuyerType } from "@/lib/registration";

type Actor = { tenantId: string; userId: string };

/** Comptes : charge du marché (646) et dette envers l'État (447300). */
export const REGISTRATION_DUTY = { accountCode: "646100", accountLabel: "Droits d'enregistrement" };
export const STAMP_DUTY = { accountCode: "646200", accountLabel: "Droits de timbre" };
export const STATE_REGISTRATION = { accountCode: "447300", accountLabel: "État, droits d'enregistrement et de timbre à payer" };

async function ensureAccounts(tenantId: string, session?: ClientSession) {
  for (const a of [REGISTRATION_DUTY, STAMP_DUTY, STATE_REGISTRATION]) await registerLedgerAccount(tenantId, a.accountCode, a.accountLabel, session);
}

/** Nature de l'acheteur : celle du marché, à défaut celle du client. */
export async function effectiveBuyerType(tenantId: string, contract: { buyerType?: string; clientId?: unknown }, session?: ClientSession): Promise<BuyerType> {
  if (contract.buyerType) return contract.buyerType as BuyerType;
  if (!contract.clientId) return "private";
  const c = await ClientModel.findOne({ _id: contract.clientId, tenantId }).select("buyerType").session(session ?? null).lean<{ buyerType?: string } | null>();
  return (c?.buyerType as BuyerType) || "private";
}

/** Estimation (sans rien écrire) : affichée sur la fiche et comptée en dépense engagée. */
export async function registrationEstimate(tenantId: string, contract: { amount: number; buyerType?: string; clientId?: unknown; instrument?: string; isSubcontract?: boolean; pages?: number; approvalDate?: Date; signedDate?: Date }) {
  const buyerType = await effectiveBuyerType(tenantId, contract);
  return {
    buyerType,
    ...assessRegistration({ buyerType, instrument: contract.instrument, amountHT: contract.amount, isSubcontract: contract.isSubcontract, pages: contract.pages }),
    dueDate: registrationDueDate(contract.approvalDate, contract.signedDate),
  };
}

function entryDateIn(date: Date | undefined) {
  return date && !isNaN(new Date(date).getTime()) ? new Date(date) : new Date();
}

/**
 * Constate les droits d'un marché : charge 646 au débit, imputée au projet
 * d'exécution (elle entre dans la marge), dette 447300 au crédit. Une seule
 * fois par marché ; l'échéance (approbation + 1 mois) déclenche les rappels.
 */
export async function assessContractRegistration(actor: Actor, contractId: string, input: { date?: unknown }, session?: ClientSession) {
  const contract = await ContractModel.findOne({ _id: contractId, tenantId: actor.tenantId }).session(session ?? null);
  if (!contract) throw new BusinessRuleError("Marché introuvable.");
  if (contract.type !== "client") throw new BusinessRuleError("Les droits d'enregistrement concernent les marchés obtenus (contrats clients).");
  if (contract.registration?.assessedAt) throw new BusinessRuleError("Les droits de ce marché sont déjà constatés.");
  if (!(contract.amount > 0)) throw new BusinessRuleError("Renseignez le montant HT du marché.");
  if (!contract.approvalDate && !contract.signedDate) throw new BusinessRuleError("Renseignez la date d'approbation (ou de signature) du marché : elle fait courir le délai d'un mois.");

  const est = await registrationEstimate(actor.tenantId, contract);
  if (!(est.total > 0)) throw new BusinessRuleError("Aucun droit à constater.");
  await ensureAccounts(actor.tenantId, session);
  const tag = contract.projectId ? { projectId: contract.projectId } : {};
  const date = entryDateIn(input.date ? new Date(String(input.date)) : contract.approvalDate ?? contract.signedDate);
  const [entry] = await AccountingEntryModel.create([{
    tenantId: actor.tenantId, journalCode: "OD", entryDate: date, reference: `ENR-${contract.reference}`,
    label: `Droits d'enregistrement et timbres — marché ${contract.reference}`,
    lines: [
      ...(est.duty > 0 ? [{ ...REGISTRATION_DUTY, debit: est.duty, credit: 0, ...tag }] : []),
      ...(est.stamp > 0 ? [{ ...STAMP_DUTY, debit: est.stamp, credit: 0, ...tag }] : []),
      { ...STATE_REGISTRATION, debit: 0, credit: est.total },
    ],
    linkedDocType: "registration", linkedDocId: contract._id, createdBy: actor.userId,
  }], { session });
  contract.set("registration", {
    kind: est.kind, article: est.article, duty: est.duty, stamp: est.stamp, receptionStamp: 0,
    assessed: est.total, paid: 0, dueDate: est.dueDate ?? undefined, assessedAt: new Date(), entryIds: [entry._id], payments: [],
  });
  if (!contract.buyerType) contract.buyerType = est.buyerType;
  await contract.save({ session });
  return { ...est, entryId: entry._id };
}

/** Timbre de 25 000 FCFA sur l'original du PV de réception définitive (marché public). */
export async function assessReceptionStamp(actor: Actor, contractId: string, session?: ClientSession) {
  const contract = await ContractModel.findOne({ _id: contractId, tenantId: actor.tenantId }).session(session ?? null);
  if (!contract) throw new BusinessRuleError("Marché introuvable.");
  if (!contract.receptionDefinitiveDate) throw new BusinessRuleError("Renseignez d'abord la date de réception définitive.");
  if ((contract.registration?.receptionStamp ?? 0) > 0) throw new BusinessRuleError("Le timbre du PV de réception est déjà constaté.");
  const amount = receptionStamp(await effectiveBuyerType(actor.tenantId, contract, session));
  if (!(amount > 0)) throw new BusinessRuleError("Pas de timbre de réception : réservé aux marchés publics.");
  await ensureAccounts(actor.tenantId, session);
  const tag = contract.projectId ? { projectId: contract.projectId } : {};
  const [entry] = await AccountingEntryModel.create([{
    tenantId: actor.tenantId, journalCode: "OD", entryDate: entryDateIn(contract.receptionDefinitiveDate), reference: `TPV-${contract.reference}`,
    label: `Timbre du PV de réception définitive — marché ${contract.reference}`,
    lines: [{ ...STAMP_DUTY, debit: amount, credit: 0, ...tag }, { ...STATE_REGISTRATION, debit: 0, credit: amount }],
    linkedDocType: "registration", linkedDocId: contract._id, createdBy: actor.userId,
  }], { session });
  const r = contract.registration ?? {};
  contract.set("registration", {
    ...(typeof r.toObject === "function" ? r.toObject() : r),
    receptionStamp: amount, assessed: (r.assessed ?? 0) + amount,
    entryIds: [...(r.entryIds ?? []), entry._id], assessedAt: r.assessedAt ?? new Date(),
  });
  await contract.save({ session });
  return { amount, entryId: entry._id };
}

/** Paiement à la recette des impôts : 447300 au débit, banque ou caisse au crédit. */
export async function payContractRegistration(actor: Actor, contractId: string, input: { treasuryAccountId?: unknown; date?: unknown; amount?: unknown; number?: unknown; registrationDate?: unknown }, session?: ClientSession) {
  const contract = await ContractModel.findOne({ _id: contractId, tenantId: actor.tenantId }).session(session ?? null);
  if (!contract) throw new BusinessRuleError("Marché introuvable.");
  const reg = contract.registration;
  const due = Math.max(0, (reg?.assessed ?? 0) - (reg?.paid ?? 0));
  if (!reg?.assessedAt || due <= 0) throw new BusinessRuleError(reg?.assessedAt ? "Les droits de ce marché sont déjà payés." : "Constatez d'abord les droits du marché.");
  const amount = input.amount !== undefined && input.amount !== "" ? Math.round(Number(input.amount)) : due;
  if (!(amount > 0) || amount > due) throw new BusinessRuleError(`Montant invalide (reste à payer : ${due.toLocaleString("fr-FR")} FCFA).`);
  if (!Types.ObjectId.isValid(String(input.treasuryAccountId ?? ""))) throw new BusinessRuleError("Choisissez le compte qui paie.");
  const ledger = await treasuryLedger(actor.tenantId, input.treasuryAccountId, session);
  if (!ledger) throw new BusinessRuleError("Compte de trésorerie introuvable.");
  const date = input.date ? new Date(String(input.date)) : new Date();
  if (isNaN(date.getTime()) || date.getTime() > Date.now() + 86_400_000) throw new BusinessRuleError("Date de paiement invalide.");

  // Garde : deux paiements simultanés ne paient pas deux fois le même reste.
  const claim = await ContractModel.updateOne({ _id: contract._id, "registration.paid": reg.paid ?? 0 }, { $inc: { "registration.paid": amount } }, { session });
  if (claim.modifiedCount !== 1) throw new BusinessRuleError("Un paiement vient d'être enregistré sur ce marché : rechargez la fiche.");
  const label = `Droits d'enregistrement payés — marché ${contract.reference}`;
  const reference = String(input.number ?? "").trim().slice(0, 60) || `ENR-${contract.reference}-RGL`;
  const [entry] = await AccountingEntryModel.create([{
    tenantId: actor.tenantId, journalCode: ledger.journalCode, entryDate: date, reference, label,
    lines: [{ ...STATE_REGISTRATION, debit: amount, credit: 0 }, { accountCode: ledger.accountCode, accountLabel: ledger.accountLabel, debit: 0, credit: amount }],
    linkedDocType: "registration", linkedDocId: contract._id, createdBy: actor.userId,
  }], { session });
  const [movement] = await TreasuryMovementModel.create([{
    tenantId: actor.tenantId, accountId: input.treasuryAccountId, date, amount: -amount, label, reference,
    source: "manual", linkedDocType: "contract", linkedDocId: contract._id, createdBy: actor.userId,
  }], { session });
  await ContractModel.updateOne({ _id: contract._id }, {
    $push: { "registration.payments": { date, amount, treasuryAccountId: input.treasuryAccountId, entryId: entry._id, movementId: movement._id } },
    $set: {
      ...(input.number ? { "registration.number": String(input.number).trim().slice(0, 60) } : {}),
      ...(input.registrationDate ? { "registration.date": new Date(String(input.registrationDate)) } : input.number ? { "registration.date": date } : {}),
    },
  }, { session });
  return { amount, remaining: due - amount, entryId: entry._id };
}

/** Annule un constat non payé (erreur de nature d'acheteur, de montant…) : écritures extournées. */
export async function cancelContractRegistration(actor: Actor, contractId: string, reason: string, session?: ClientSession) {
  const contract = await ContractModel.findOne({ _id: contractId, tenantId: actor.tenantId }).session(session ?? null);
  if (!contract?.registration?.assessedAt) throw new BusinessRuleError("Aucun droit constaté sur ce marché.");
  if ((contract.registration.paid ?? 0) > 0) throw new BusinessRuleError("Droits déjà payés : le constat ne s'annule plus.");
  for (const id of contract.registration.entryIds ?? []) {
    const e = await AccountingEntryModel.findOne({ _id: id, tenantId: actor.tenantId, reversedBy: { $exists: false } }).select("_id").session(session ?? null);
    if (e) await reverseEntry({ tenantId: actor.tenantId, userId: actor.userId, entryId: e._id, reason: `constat des droits annulé : ${reason}` }, session);
  }
  contract.set("registration", undefined);
  await contract.save({ session });
}
