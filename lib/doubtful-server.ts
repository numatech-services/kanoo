import { Types, type ClientSession } from "mongoose";
import { InvoiceModel } from "@/models/Invoice";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { registerLedgerAccount } from "@/lib/treasury";
import { BusinessRuleError } from "@/lib/errors";
import {
  DOUBTFUL_ACCOUNT, PROVISION_ACCOUNT, PROVISION_CHARGE, PROVISION_REVERSAL, BAD_DEBT_LOSS,
  requiredProvision, provisionLines, writeOffLines, suggestedRate,
} from "@/lib/doubtful";

type Actor = { tenantId: string; userId: string };
/* eslint-disable @typescript-eslint/no-explicit-any */
type InvoiceDoc = any;

/** Reste dû exigible (même règle que invoiceDue, sans dépendance circulaire). */
const dueOf = (i: { totalTTC: number; paidAmount?: number; creditedAmount?: number; retentionAmount?: number; status?: string }) =>
  i.status === "written_off" ? 0 : Math.max(0, Math.round(i.totalTTC - (i.creditedAmount || 0) - (i.paidAmount || 0) - (i.status === "cancelled" ? 0 : i.retentionAmount || 0)));

async function ensureAccounts(tenantId: string, session?: ClientSession) {
  for (const a of [DOUBTFUL_ACCOUNT, PROVISION_ACCOUNT, PROVISION_CHARGE, PROVISION_REVERSAL, BAD_DEBT_LOSS]) {
    await registerLedgerAccount(tenantId, a.accountCode, a.accountLabel, session);
  }
}

async function postOD(actor: Actor, invoice: InvoiceDoc, date: Date, label: string, lines: Array<Record<string, unknown>>, session?: ClientSession) {
  if (!lines.length) return null;
  const [e] = await AccountingEntryModel.create([{
    tenantId: actor.tenantId, journalCode: "OD", entryDate: date, reference: invoice.number, label,
    lines, linkedDocType: "invoice", linkedDocId: invoice._id, createdBy: actor.userId,
  }], { session });
  return e;
}

/**
 * Ajuste la dépréciation d'une créance douteuse au taux donné, sur son reste dû
 * actuel : dotation si elle doit croître, reprise si elle doit baisser (règlement
 * reçu, meilleure estimation). Sans effet si rien ne change.
 */
export async function adjustProvision(actor: Actor, invoice: InvoiceDoc, rate: number, date: Date, session?: ClientSession) {
  if (!invoice.doubtfulAt) throw new BusinessRuleError("Classez d'abord la créance en douteuse.");
  if (!(rate >= 0 && rate <= 1)) throw new BusinessRuleError("Taux de dépréciation : entre 0 et 100 %.");
  const target = requiredProvision(dueOf(invoice), invoice, rate);
  const current = Math.round(invoice.provisionAmount || 0);
  const lines = provisionLines(current, target).map(l => l.accountCode === PROVISION_ACCOUNT.accountCode ? { ...l, thirdPartyId: invoice.clientId } : l);
  await postOD(actor, invoice, date, `${target > current ? "Dépréciation" : "Reprise de dépréciation"} — créance ${invoice.number}`, lines, session);
  invoice.provisionRate = rate;
  invoice.provisionAmount = target;
  await invoice.save({ session });
  return { current, target, delta: target - current };
}

/** Classe une facture en créance douteuse (411 → 416) et la déprécie au taux donné. */
export async function markDoubtful(actor: Actor, invoiceId: string, input: { rate?: unknown; date?: unknown }, session?: ClientSession) {
  const invoice = Types.ObjectId.isValid(invoiceId) ? await InvoiceModel.findOne({ _id: invoiceId, tenantId: actor.tenantId, documentType: { $ne: "credit_note" } }).session(session ?? null) : null;
  if (!invoice) throw new BusinessRuleError("Facture introuvable.");
  if (invoice.doubtfulAt) throw new BusinessRuleError("Créance déjà classée douteuse.");
  if (!["sent", "partial", "overdue"].includes(invoice.status)) throw new BusinessRuleError("Seule une facture émise et non soldée peut devenir douteuse.");
  const due = dueOf(invoice);
  if (!(due > 0)) throw new BusinessRuleError("Rien à recouvrer sur cette facture.");
  const date = input.date ? new Date(String(input.date)) : new Date();
  if (isNaN(date.getTime())) throw new BusinessRuleError("Date invalide.");
  const daysLate = invoice.dueDate ? Math.floor((date.getTime() - new Date(invoice.dueDate).getTime()) / 86_400_000) : 0;
  const rate = input.rate === undefined || input.rate === "" ? suggestedRate(daysLate) : Number(input.rate);
  await ensureAccounts(actor.tenantId, session);
  await postOD(actor, invoice, date, `Créance douteuse — facture ${invoice.number}`, [
    { ...DOUBTFUL_ACCOUNT, debit: due, credit: 0, thirdPartyId: invoice.clientId },
    { accountCode: "411000", accountLabel: "Clients", debit: 0, credit: due, thirdPartyId: invoice.clientId },
  ], session);
  invoice.doubtfulAt = date;
  return { transferred: due, ...(await adjustProvision(actor, invoice, rate, date, session)) };
}

/**
 * Créance irrécouvrable : perte (651) sur le HT, TVA collectée régularisée,
 * dépréciation reprise. La facture reste dans les ventes, au statut « irrécouvrable ».
 */
export async function writeOff(actor: Actor, invoiceId: string, input: { date?: unknown; recoverVat?: unknown }, session?: ClientSession) {
  const invoice = Types.ObjectId.isValid(invoiceId) ? await InvoiceModel.findOne({ _id: invoiceId, tenantId: actor.tenantId, documentType: { $ne: "credit_note" } }).session(session ?? null) : null;
  if (!invoice) throw new BusinessRuleError("Facture introuvable.");
  if (!["sent", "partial", "overdue"].includes(invoice.status)) throw new BusinessRuleError("Seule une facture émise et non soldée peut être passée en perte.");
  const due = dueOf(invoice);
  if (!(due > 0)) throw new BusinessRuleError("Rien à passer en perte.");
  const date = input.date ? new Date(String(input.date)) : new Date();
  if (isNaN(date.getTime())) throw new BusinessRuleError("Date invalide.");
  await ensureAccounts(actor.tenantId, session);
  const fromAccount = invoice.doubtfulAt ? DOUBTFUL_ACCOUNT.accountCode : "411000";
  await postOD(actor, invoice, date, `Créance irrécouvrable — facture ${invoice.number}`,
    writeOffLines(due, invoice, { fromAccount, recoverVat: input.recoverVat !== false && input.recoverVat !== "false", clientId: invoice.clientId }), session);
  const provision = Math.round(invoice.provisionAmount || 0);
  if (provision > 0) {
    await postOD(actor, invoice, date, `Reprise de dépréciation — créance ${invoice.number} passée en perte`,
      provisionLines(provision, 0).map(l => l.accountCode === PROVISION_ACCOUNT.accountCode ? { ...l, thirdPartyId: invoice.clientId } : l), session);
  }
  invoice.provisionAmount = 0;
  invoice.writtenOffAt = date;
  invoice.writtenOffAmount = due;
  invoice.status = "written_off";
  await invoice.save({ session });
  return { loss: due, provisionReversed: provision };
}

/**
 * Créances à surveiller (en retard de 90 jours et plus, non douteuses) et
 * créances douteuses avec leur dépréciation comptabilisée et requise.
 */
export async function provisionsOverview(tenantId: string, now = new Date()) {
  const tid = new Types.ObjectId(tenantId);
  const rows = await InvoiceModel.find({ tenantId: tid, documentType: { $ne: "credit_note" }, status: { $in: ["sent", "partial", "overdue"] },
    $or: [{ doubtfulAt: { $exists: true } }, { dueDate: { $lt: new Date(now.getTime() - 90 * 86_400_000) } }] })
    .populate("clientId", "name").sort({ dueDate: 1 }).limit(500)
    .select("number clientId issueDate dueDate totalHT totalTTC paidAmount creditedAmount retentionAmount status doubtfulAt provisionRate provisionAmount")
    .lean<Array<{ _id: Types.ObjectId; number: string; clientId?: { name?: string }; dueDate?: Date; totalHT: number; totalTTC: number; paidAmount?: number; creditedAmount?: number; retentionAmount?: number; status: string; doubtfulAt?: Date; provisionRate?: number; provisionAmount?: number }>>();
  const items = rows.map(i => {
    const due = dueOf(i);
    const daysLate = i.dueDate ? Math.max(0, Math.floor((now.getTime() - new Date(i.dueDate).getTime()) / 86_400_000)) : 0;
    const rate = i.doubtfulAt ? (i.provisionRate ?? 0) : suggestedRate(daysLate);
    const required = requiredProvision(due, i, rate);
    return {
      _id: String(i._id), number: i.number, client: i.clientId?.name ?? "", dueDate: i.dueDate, daysLate, due,
      doubtful: !!i.doubtfulAt, doubtfulAt: i.doubtfulAt, rate, suggestedRate: suggestedRate(daysLate),
      provision: Math.round(i.provisionAmount ?? 0), required, toAdjust: i.doubtfulAt ? required - Math.round(i.provisionAmount ?? 0) : 0,
    };
  }).filter(i => i.due > 0 || i.doubtful);
  const doubtful = items.filter(i => i.doubtful);
  return {
    items,
    totals: {
      doubtfulTTC: doubtful.reduce((t, i) => t + i.due, 0),
      provision: doubtful.reduce((t, i) => t + i.provision, 0),
      required: doubtful.reduce((t, i) => t + i.required, 0),
      watchTTC: items.filter(i => !i.doubtful).reduce((t, i) => t + i.due, 0),
    },
  };
}

/** Ajuste toutes les dépréciations à leur taux actuel (inventaire de fin de période). */
export async function adjustAllProvisions(actor: Actor, date: Date, session?: ClientSession) {
  const list = await InvoiceModel.find({ tenantId: actor.tenantId, doubtfulAt: { $exists: true }, status: { $in: ["sent", "partial", "overdue", "paid"] } }).session(session ?? null);
  let dotations = 0, reprises = 0;
  for (const inv of list) {
    const r = await adjustProvision(actor, inv, inv.provisionRate ?? 0, date, session);
    if (r.delta > 0) dotations += r.delta; else reprises -= r.delta;
  }
  return { count: list.length, dotations, reprises };
}
