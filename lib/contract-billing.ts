import type { ClientSession, Types } from "mongoose";
import { ContractModel } from "@/models/Contract";
import { InvoiceModel } from "@/models/Invoice";
import { calculerTVA, TVA_TAUX_STANDARD } from "@/lib/niger-fiscal";
import { provisionalNumber } from "@/lib/numbering";
import { BusinessRuleError } from "@/lib/errors";
import type { TokenPayload } from "@/lib/auth";

/** Échéance suivante d'un contrat récurrent, à partir de l'échéance facturée. */
export function nextPeriod(from: Date, frequency?: string): Date {
  const d = new Date(from);
  if (frequency === "quarterly") d.setMonth(d.getMonth() + 3);
  else if (frequency === "biannual") d.setMonth(d.getMonth() + 6);
  else if (frequency === "annual") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

const FREQ_LABEL: Record<string, string> = { monthly: "mois", quarterly: "trimestre", biannual: "semestre", annual: "année" };

/** Libellé de la période facturée : « Maintenance — CT-2026-0004 (mois du 01/10/2026) ». */
function periodLabel(title: string, reference: string, due: Date | null, freq?: string) {
  return `${title} — ${reference}${due ? ` (${FREQ_LABEL[freq ?? "monthly"] ?? "période"} du ${due.toLocaleDateString("fr-FR")})` : ""}`;
}

/**
 * Facture (brouillon) de la prochaine période d'un contrat récurrent actif.
 * Une seule par échéance : l'échéance est réservée sur la valeur lue, le second
 * appel (double clic, tâche planifiée concurrente) ne la trouve plus. Le taux
 * de TVA est celui du contrat (exonération d'un financement extérieur), sinon
 * le taux standard. Numéro définitif attribué à l'émission.
 */
export async function billContractPeriod(
  auth: Pick<TokenPayload, "tenantId" | "userId">, contractId: unknown,
  opts: { tvaRate?: number; now?: Date } = {}, session?: ClientSession,
) {
  const contract = await ContractModel.findOne({ _id: contractId, tenantId: auth.tenantId }).session(session ?? null);
  if (!contract) throw new BusinessRuleError("Contrat introuvable");
  if (!contract.clientId) throw new BusinessRuleError("Le contrat doit être lié à un client");
  if (!(contract.amount > 0)) throw new BusinessRuleError("Le montant du contrat doit être supérieur à 0");
  if (!contract.isRecurring) throw new BusinessRuleError("Contrat non récurrent : facturez depuis l'échéancier du marché.");
  if (!["active", "renewed"].includes(contract.status)) throw new BusinessRuleError("Seul un contrat actif se facture.");
  const now = opts.now ?? new Date();
  const due = contract.nextBillingDate ? new Date(contract.nextBillingDate) : null;
  const endOfToday = new Date(now); endOfToday.setHours(23, 59, 59, 999);
  if (due && due > endOfToday) throw new BusinessRuleError(`Période déjà facturée : prochaine échéance le ${due.toLocaleDateString("fr-FR")}.`);
  // Contrat échu : on ne facture pas une période qui commence après sa fin.
  if (due && contract.endDate && due > new Date(contract.endDate)) throw new BusinessRuleError("Contrat échu : plus de période à facturer.");
  const rate = opts.tvaRate !== undefined ? Number(opts.tvaRate) : contract.tvaRate ?? TVA_TAUX_STANDARD;
  if (!(rate >= 0 && rate < 1)) throw new BusinessRuleError("Taux de TVA invalide (fraction : 0,19).");

  const totalHT = Math.round(contract.amount);
  const totalTVA = calculerTVA(totalHT, rate);
  const totalTTC = totalHT + totalTVA;
  const issueDate = new Date(now);
  const dueDate = new Date(now); dueDate.setDate(dueDate.getDate() + 30);

  const claim = await ContractModel.updateOne(
    { _id: contract._id, nextBillingDate: contract.nextBillingDate ?? null },
    { $set: { lastBilledDate: now, nextBillingDate: nextPeriod(due ?? now, contract.billingFrequency) } }, { session });
  if (claim.modifiedCount !== 1) throw new BusinessRuleError("Cette période vient d'être facturée.");

  const [invoice] = await InvoiceModel.create([{
    tenantId: auth.tenantId, number: provisionalNumber(), clientId: contract.clientId, contractId: contract._id,
    ...(contract.projectId ? { projectId: contract.projectId } : {}),
    lines: [{
      description: periodLabel(contract.title, contract.reference, due, contract.billingFrequency),
      quantity: 1, unitPrice: totalHT, tvaRate: rate, discount: 0, totalHT, totalTVA, totalTTC,
    }],
    totalHT, totalTVA, totalDTS: 0, totalTTC, paidAmount: 0, status: "draft", issueDate, dueDate,
    notes: `Généré depuis le contrat ${contract.reference}`, createdBy: auth.userId,
  }], { session });
  await ContractModel.updateOne({ _id: contract._id }, { $push: { invoiceIds: invoice._id } }, { session });
  return { invoice, contract: { _id: contract._id as Types.ObjectId, reference: contract.reference, title: contract.title } };
}
