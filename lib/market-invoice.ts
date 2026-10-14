import { Types, type ClientSession } from "mongoose";
import { InvoiceModel } from "@/models/Invoice";
import { ContractModel } from "@/models/Contract";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { ClientModel } from "@/models/Client";
import { computeInvoiceLines, saleEntryLines, type InvoiceLineIn } from "@/lib/invoice-entry";
import { nextDocumentNumber } from "@/lib/numbering";
import { TVA_TAUX_STANDARD } from "@/lib/niger-fiscal";
import { BusinessRuleError } from "@/lib/errors";
import type { TokenPayload } from "@/lib/auth";

export class MarketError extends BusinessRuleError {}

type Milestone = { _id: Types.ObjectId; label: string; amount: number; dueDate?: Date; invoiceId?: unknown; status: string; kind?: string };
export type MarketContract = {
  _id: Types.ObjectId; reference: string; title: string; type: string; status: string; amount: number;
  clientId?: unknown; projectId?: unknown; devisId?: unknown; invoiceIds: unknown[]; milestones: Milestone[];
  lastBilledDate?: Date;
  save: (o?: { session?: ClientSession }) => Promise<unknown>;
  markModified: (p: string) => void;
};

export interface MarketInvoiceInput {
  /** `deposit` : facture d'acompte ; `standard` : facture du marché (déduit les acomptes). */
  mode?: unknown;
  /** Montant HT, ou pourcentage du marché (`rate`, 0–100). */
  amountHT?: unknown;
  rate?: unknown;
  milestoneId?: unknown;
  description?: unknown;
  /** Facture ordinaire : déduire les acomptes disponibles (oui par défaut). */
  deductDeposits?: unknown;
  tvaRate?: unknown;
  issueDate?: unknown;
  dueDays?: unknown;
}

/** État de facturation d'un marché, lu sur ses factures (hors annulées). */
export async function marketBilling(tenantId: string, contractId: unknown, session?: ClientSession) {
  const invoices = await InvoiceModel.find({ tenantId, contractId, documentType: "invoice", status: { $ne: "cancelled" } })
    .sort({ issueDate: 1, createdAt: 1 }).session(session ?? null)
    .lean<Array<{ _id: Types.ObjectId; number: string; kind?: string; totalHT: number; depositUsedHT?: number; lines: Array<{ totalHT: number; tvaRate?: number; kind?: string }> }>>();
  const deposits = invoices.filter(i => i.kind === "deposit");
  const workHT = invoices.filter(i => i.kind !== "deposit")
    .reduce((t, i) => t + i.lines.filter(l => l.kind !== "deposit_deduction").reduce((u, l) => u + l.totalHT, 0), 0);
  const available = deposits.map(d => ({ _id: d._id, number: d.number, rate: d.lines[0]?.tvaRate ?? TVA_TAUX_STANDARD, free: d.totalHT - (d.depositUsedHT ?? 0) }))
    .filter(d => d.free > 0);
  return { workHT, depositsHT: deposits.reduce((t, d) => t + d.totalHT, 0), available, availableHT: available.reduce((t, d) => t + d.free, 0) };
}

/**
 * Facture un marché : acompte (avance, compte 419) ou facture ordinaire qui
 * déduit les acomptes non encore imputés. Le total facturé (travaux + acomptes
 * en cours) ne dépasse jamais le montant HT du marché.
 */
export async function invoiceMarket(auth: TokenPayload, contract: MarketContract, input: MarketInvoiceInput, session?: ClientSession) {
  if (contract.type !== "client" || !contract.clientId) throw new MarketError("Seul un marché client, lié à un client, se facture.");
  if (!["active", "renewed"].includes(contract.status)) throw new MarketError("Activez (signez) le marché avant de le facturer.");
  const client = await ClientModel.findOne({ _id: contract.clientId, tenantId: auth.tenantId }).select("name").session(session ?? null).lean<{ _id: unknown; name: string } | null>();
  if (!client) throw new MarketError("Client du marché introuvable.");

  let mode = input.mode === "deposit" ? "deposit" : "standard";
  let amountHT = input.amountHT !== undefined && input.amountHT !== "" ? Math.round(Number(input.amountHT))
    : input.rate !== undefined && input.rate !== "" ? Math.round(contract.amount * Number(input.rate) / 100) : NaN;
  let description = String(input.description ?? "").trim().slice(0, 300);
  let milestone: Milestone | undefined;
  if (input.milestoneId) {
    milestone = contract.milestones.find(m => String(m._id) === String(input.milestoneId));
    if (!milestone) throw new MarketError("Échéance introuvable.");
    if (milestone.status !== "pending") throw new MarketError("Cette échéance est déjà facturée.");
    mode = milestone.kind === "deposit" ? "deposit" : "standard";
    amountHT = Math.round(milestone.amount);
    description ||= milestone.label;
  }

  const billing = await marketBilling(auth.tenantId, contract._id, session);
  const outstanding = billing.availableHT;
  if (!Number.isFinite(amountHT) && mode === "standard") amountHT = contract.amount - billing.workHT;
  if (!(amountHT > 0)) throw new MarketError("Montant à facturer invalide.");
  // Plafond : le marché. Une facture qui déduit les acomptes peut aller jusqu'au
  // reste des travaux ; sinon, les acomptes non imputés comptent déjà.
  const deducting = mode === "standard" && input.deductDeposits !== false && input.deductDeposits !== "false";
  const ceiling = contract.amount - billing.workHT - (deducting ? 0 : outstanding);
  if (amountHT > ceiling) {
    throw new MarketError(`Le montant dépasse le reste à facturer du marché (${Math.max(0, ceiling).toLocaleString("fr-FR")} FCFA HT).`);
  }
  const tvaRate = input.tvaRate !== undefined && input.tvaRate !== "" ? Number(input.tvaRate) : TVA_TAUX_STANDARD;
  if (!(tvaRate >= 0 && tvaRate < 1)) throw new MarketError("Taux de TVA invalide.");

  const raw: InvoiceLineIn[] = [{
    description: description || (mode === "deposit" ? `Acompte — ${contract.title} (${contract.reference})` : `${contract.title} — ${contract.reference}`),
    quantity: 1, unitPrice: amountHT, tvaRate, discount: 0,
  }];
  // Déduction des acomptes, du plus ancien au plus récent, dans la limite du montant facturé.
  const used: Array<{ _id: Types.ObjectId; amount: number }> = [];
  if (deducting) {
    let left = amountHT;
    for (const d of billing.available) {
      if (left <= 0) break;
      const take = Math.min(d.free, left);
      raw.push({ description: `Déduction de l'acompte ${d.number}`, quantity: 1, unitPrice: -take, tvaRate: d.rate, discount: 0, kind: "deposit_deduction", depositInvoiceId: d._id });
      used.push({ _id: d._id, amount: take });
      left -= take;
    }
  }
  const { lines, totalHT, totalTVA, totalDTS, totalTTC } = computeInvoiceLines(raw, { allowDeduction: true });

  const issueDate = input.issueDate ? new Date(String(input.issueDate)) : new Date();
  if (isNaN(issueDate.getTime())) throw new MarketError("Date d'émission invalide.");
  const dueDate = new Date(issueDate);
  dueDate.setDate(dueDate.getDate() + (Number(input.dueDays) > 0 ? Number(input.dueDays) : 30));

  const number = await nextDocumentNumber(auth.tenantId, "invoice", { issueDate, session });
  const [invoice] = await InvoiceModel.create([{
    tenantId: auth.tenantId, number, clientId: contract.clientId, kind: mode, contractId: contract._id,
    ...(milestone ? { milestoneId: milestone._id } : {}),
    ...(contract.projectId ? { projectId: contract.projectId } : {}),
    ...(contract.devisId ? { quoteId: contract.devisId } : {}),
    lines, totalHT, totalTVA, totalDTS, totalTTC, paidAmount: 0, status: "draft", issueDate, dueDate,
    notes: mode === "deposit" ? `Acompte sur le marché ${contract.reference}` : `Marché ${contract.reference}`,
    createdBy: auth.userId,
  }], { session });

  for (const u of used) {
    const r = await InvoiceModel.updateOne(
      { _id: u._id, tenantId: auth.tenantId, $expr: { $lte: [{ $add: [{ $ifNull: ["$depositUsedHT", 0] }, u.amount] }, "$totalHT"] } },
      { $inc: { depositUsedHT: u.amount } }, { session },
    );
    if (!r.modifiedCount) throw new MarketError("Un acompte vient d'être déduit ailleurs : recommencez.");
  }

  await AccountingEntryModel.create([{
    tenantId: auth.tenantId, journalCode: "VT", entryDate: issueDate, reference: number,
    label: `${mode === "deposit" ? "Acompte" : "Facture"} marché ${contract.reference} — ${client.name}`,
    lines: await saleEntryLines(auth.tenantId, { clientId: contract.clientId, lines, totalTVA, totalDTS, totalTTC, kind: mode, ...(contract.projectId ? { projectId: contract.projectId } : {}) }, session),
    linkedDocType: "invoice", linkedDocId: invoice._id, createdBy: auth.userId,
  }], { session });

  contract.invoiceIds.push(invoice._id);
  contract.lastBilledDate = issueDate;
  if (milestone) { milestone.status = "invoiced"; milestone.invoiceId = invoice._id; contract.markModified("milestones"); }
  await contract.save({ session });
  return invoice;
}

/**
 * Facture de marché annulée (annulation ou avoir total) : les acomptes qu'elle
 * déduisait redeviennent disponibles et son échéance est de nouveau à facturer.
 */
export async function releaseMarketInvoice(
  tenantId: string,
  inv: { contractId?: unknown; milestoneId?: unknown; lines: Array<{ kind?: string; depositInvoiceId?: unknown; totalHT: number }> },
  session?: ClientSession,
) {
  for (const l of inv.lines.filter(x => x.kind === "deposit_deduction")) {
    await InvoiceModel.updateOne({ _id: l.depositInvoiceId, tenantId }, { $inc: { depositUsedHT: l.totalHT } }, { session });
  }
  if (inv.contractId && inv.milestoneId) {
    await ContractModel.updateOne(
      { _id: inv.contractId, tenantId, "milestones._id": inv.milestoneId },
      { $set: { "milestones.$.status": "pending" }, $unset: { "milestones.$.invoiceId": 1 } },
      { session },
    );
  }
}
