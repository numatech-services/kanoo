import { Types } from "mongoose";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { PaymentModel } from "@/models/Payment";
import { InvoiceModel } from "@/models/Invoice";
import { proposeLetters, type LetterLine } from "@/lib/auto-lettering";

/**
 * Lignes ouvertes d'un compte de tiers (411, 401…), avec la clé du document
 * d'origine : la facture pour une vente, ses règlements et ses avoirs ;
 * l'achat pour ses règlements.
 */
export async function openLetterLines(tenantId: string, account: string): Promise<LetterLine[]> {
  const tid = new Types.ObjectId(tenantId);
  const rows = await AccountingEntryModel.aggregate<{ _id: Types.ObjectId; entryDate: Date; linkedDocType?: string; linkedDocId?: Types.ObjectId; reverses?: Types.ObjectId; reversedBy?: Types.ObjectId; amount: number; thirdPartyId?: Types.ObjectId; parties: number }>([
    { $match: { tenantId: tid, isLettered: { $ne: true }, "lines.accountCode": { $regex: `^${account}` } } },
    { $unwind: "$lines" }, { $match: { "lines.accountCode": { $regex: `^${account}` } } },
    { $group: {
      _id: "$_id", entryDate: { $first: "$entryDate" }, linkedDocType: { $first: "$linkedDocType" }, linkedDocId: { $first: "$linkedDocId" },
      reverses: { $first: "$reverses" }, reversedBy: { $first: "$reversedBy" },
      amount: { $sum: { $subtract: ["$lines.debit", "$lines.credit"] } }, thirdPartyId: { $first: "$lines.thirdPartyId" }, parties: { $addToSet: "$lines.thirdPartyId" },
    } },
    { $project: { entryDate: 1, linkedDocType: 1, linkedDocId: 1, reverses: 1, reversedBy: 1, amount: 1, thirdPartyId: 1, parties: { $size: "$parties" } } },
    { $limit: 5000 },
  ]);
  // Une écriture qui touche plusieurs tiers sur ce compte ne se lettre pas automatiquement.
  const usable = rows.filter(r => r.parties <= 1);

  const paymentIds = usable.filter(r => r.linkedDocType === "payment" && r.linkedDocId).map(r => r.linkedDocId!);
  const invoiceIds = usable.filter(r => r.linkedDocType === "invoice" && r.linkedDocId).map(r => r.linkedDocId!);
  const [payments, invoices] = await Promise.all([
    paymentIds.length ? PaymentModel.find({ tenantId: tid, _id: { $in: paymentIds } }).select("invoiceId").lean<Array<{ _id: Types.ObjectId; invoiceId: Types.ObjectId }>>() : [],
    invoiceIds.length ? InvoiceModel.find({ tenantId: tid, _id: { $in: invoiceIds } }).select("documentType originalInvoiceId").lean<Array<{ _id: Types.ObjectId; documentType?: string; originalInvoiceId?: Types.ObjectId }>>() : [],
  ]);
  const paymentInvoice = new Map(payments.map(p => [String(p._id), String(p.invoiceId)]));
  // Un avoir se rattache à la facture qu'il annule.
  const invoiceRoot = new Map(invoices.map(i => [String(i._id), String(i.documentType === "credit_note" && i.originalInvoiceId ? i.originalInvoiceId : i._id)]));

  const docKey = (r: (typeof usable)[number]): string | null => {
    const id = r.linkedDocId ? String(r.linkedDocId) : null;
    if (!id) return null;
    switch (r.linkedDocType) {
      case "invoice": return `inv:${invoiceRoot.get(id) ?? id}`;
      case "payment": return paymentInvoice.has(id) ? `inv:${paymentInvoice.get(id)}` : null;
      case "credit_note": return `inv:${invoiceRoot.get(id) ?? id}`;
      case "supplier_invoice": case "supplier_payment": return `pur:${id}`;
      default: return null;
    }
  };
  return usable.map(r => ({
    entryId: String(r._id), date: r.entryDate, amount: Math.round(r.amount),
    thirdPartyId: r.thirdPartyId ? String(r.thirdPartyId) : null,
    docKey: docKey(r),
    reversalKey: r.reverses ? String(r.reverses) : r.reversedBy ? String(r._id) : null,
  }));
}

/** Propose (ou applique) le lettrage automatique d'un compte de tiers. */
export async function autoLetter(tenantId: string, account: string, apply: boolean) {
  const groups = proposeLetters(await openLetterLines(tenantId, account));
  if (!apply || !groups.length) return { groups, applied: 0 };
  const year = new Date().getFullYear();
  let n = (await AccountingEntryModel.distinct("letterRef", { tenantId, letterRef: { $regex: `^LET-${year}-` } })).length;
  let applied = 0;
  for (const g of groups) {
    const letterRef = `LET-${year}-${String(++n).padStart(4, "0")}`;
    // Garde : aucune de ces écritures n'a été lettrée entre-temps.
    const r = await AccountingEntryModel.updateMany({ tenantId, _id: { $in: g.entryIds }, isLettered: { $ne: true } }, { $set: { isLettered: true, letterRef } });
    if (r.modifiedCount !== g.entryIds.length) {
      await AccountingEntryModel.updateMany({ tenantId, letterRef }, { $set: { isLettered: false }, $unset: { letterRef: "" } });
      continue;
    }
    applied++;
  }
  return { groups, applied };
}
