import type { ClientSession } from "mongoose";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { ClientModel } from "@/models/Client";
import { InvoiceModel } from "@/models/Invoice";
import { saleEntryLines, findSaleEntry } from "@/lib/invoice-entry";
import { BusinessRuleError } from "@/lib/errors";

/**
 * Comptabilisation des factures de vente — un seul chemin pour toutes.
 *
 * Une facture est comptabilisée à son ÉMISSION, jamais au brouillon : un
 * brouillon n'est pas opposable, il se modifie ou se supprime, et l'écrire
 * en journal gonflait le chiffre d'affaires et la TVA collectée de ventes qui
 * n'avaient pas eu lieu. Six routes créaient chacune leur écriture à la
 * création ; elles créent désormais un brouillon, et l'émission passe ici.
 *
 * Sont des émissions : l'envoi (« Émettre »), le premier règlement enregistré
 * sur un brouillon, et les factures créées directement émises (lots de
 * marchés-cadres).
 */

type InvoiceDoc = {
  _id: unknown; number: string; status: string; kind?: string; clientId: unknown;
  issueDate: Date; documentType?: string; projectId?: unknown; activityId?: unknown;
  lines: Array<{ productId?: unknown; totalHT: number; kind?: string; depositInvoiceId?: unknown }>;
  totalTVA: number; totalDTS?: number; totalTTC: number; retentionAmount?: number;
  save: (o?: { session?: ClientSession }) => Promise<unknown>;
};

export interface PostingActor { tenantId: string; userId: string }

/**
 * Écriture de vente d'une facture, si elle n'existe pas déjà (idempotent :
 * les brouillons d'avant octobre 2026 sont déjà écrits et ne le sont pas deux fois).
 */
export async function postInvoice(actor: PostingActor, invoice: InvoiceDoc, session?: ClientSession) {
  if (await findSaleEntry(actor.tenantId, invoice._id, session)) return null;
  const client = await ClientModel.findOne({ _id: invoice.clientId, tenantId: actor.tenantId })
    .select("name").session(session ?? null).lean<{ name: string } | null>();
  const what = invoice.kind === "deposit" ? "Facture d'acompte" : "Facture client";
  const [entry] = await AccountingEntryModel.create([{
    tenantId: actor.tenantId, journalCode: "VT", entryDate: invoice.issueDate, reference: invoice.number,
    label: `${what} ${client?.name ?? ""} — ${invoice.number}`.replace("  ", " "),
    lines: await saleEntryLines(actor.tenantId, {
      clientId: invoice.clientId, lines: invoice.lines, totalTVA: invoice.totalTVA, totalDTS: invoice.totalDTS ?? 0,
      totalTTC: invoice.totalTTC, kind: invoice.kind, retentionAmount: invoice.retentionAmount ?? 0,
      ...(invoice.projectId ? { projectId: invoice.projectId } : {}),
      ...(invoice.activityId ? { activityId: invoice.activityId } : {}),
    }, session),
    linkedDocType: "invoice", linkedDocId: invoice._id, createdBy: actor.userId,
  }], { session });
  return entry;
}

/**
 * Émet un brouillon : statut « émise » et écriture de vente, dans la même
 * transaction. Une facture de solde n'est émise qu'avec les acomptes qu'elle
 * déduit — sinon le compte 419 serait débité d'une avance jamais constatée.
 */
export async function issueInvoice(actor: PostingActor, invoice: InvoiceDoc, session?: ClientSession) {
  if (invoice.documentType === "credit_note") throw new BusinessRuleError("Un avoir est émis dès sa création.");
  if (invoice.status === "cancelled") throw new BusinessRuleError("Une facture annulée ne s'émet pas.");
  if (invoice.status !== "draft") return invoice;

  const depositIds = invoice.lines.filter(l => l.kind === "deposit_deduction" && l.depositInvoiceId).map(l => l.depositInvoiceId);
  if (depositIds.length) {
    const drafts = await InvoiceModel.find({ _id: { $in: depositIds }, tenantId: actor.tenantId, status: "draft" }).session(session ?? null);
    for (const d of drafts) await issueInvoice(actor, d as unknown as InvoiceDoc, session);
  }

  invoice.status = "sent";
  await invoice.save({ session });
  await postInvoice(actor, invoice, session);
  return invoice;
}
