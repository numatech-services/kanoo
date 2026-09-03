import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, conflict, tenantFilter } from "@/lib/api-helpers";
import { DevisModel } from "@/models/Devis";
import { InvoiceModel } from "@/models/Invoice";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { withTransaction } from "@/lib/db";
import { calculerDTS } from "@/lib/niger-fiscal";
import { nextDocumentNumber } from "@/lib/numbering";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

// POST /api/devis/:id/to-invoice
// Transforme un devis accepté en facture (ou facture proforma si body.type=proforma)
export const POST = withAuth("devis", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const invoiceType = body.type || "invoice"; // "invoice" | "proforma"

  const devis = await DevisModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!devis) return notFound("Devis introuvable");
  if (!["accepted", "sent", "draft"].includes(devis.status) && invoiceType !== "proforma") {
    return badRequest("Seuls les devis acceptés, envoyés ou en brouillon peuvent être convertis");
  }
  if (devis.convertedToInvoiceId) return conflict("Ce devis a déjà été converti en facture");

  // La numérotation passait par « dernière facture créée + 1 », lu hors
  // transaction : deux conversions simultanées tiraient le même numéro (et
  // butaient sur l'index unique), et le préfixe personnalisé du tenant était
  // ignoré au profit du format « FAC- » codé en dur.
  const totalDTS = calculerDTS(devis.totalTTC);
  const issueDate = new Date();
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + (body.paymentTermDays || 30));

  const result = await withTransaction(async (session) => {
    const number = await nextDocumentNumber(auth.tenantId, "invoice", { issueDate, session });
    const [invoice] = await InvoiceModel.create([{
      tenantId: auth.tenantId,
      number,
      clientId: devis.clientId,
      quoteId: devis._id,
      lines: devis.lines,
      totalHT: devis.totalHT,
      totalTVA: devis.totalTVA,
      totalDTS,
      totalTTC: devis.totalTTC + totalDTS,
      paidAmount: 0,
      status: "draft",
      issueDate,
      dueDate,
      notes: `Convertie depuis devis ${devis.number}${invoiceType === "proforma" ? " (Proforma)" : ""}`,
      isProforma: invoiceType === "proforma",
      createdBy: auth.userId,
    }], { session });

    // Marquer le devis comme converti
    devis.convertedToInvoiceId = invoice._id;
    devis.status = "accepted";
    await devis.save({ session });

    // Écriture comptable seulement si facture définitive
    if (invoiceType !== "proforma") {
      await AccountingEntryModel.create([{
        tenantId: auth.tenantId, journalCode: "VT", entryDate: new Date(),
        reference: number, label: `Facture client — convertie du devis ${devis.number}`,
        lines: [
          { accountCode: "411000", accountLabel: "Clients", debit: invoice.totalTTC, credit: 0, thirdPartyId: devis.clientId },
          { accountCode: "706000", accountLabel: "Prestations", debit: 0, credit: devis.totalHT },
          ...(devis.totalTVA > 0 ? [{ accountCode: "443000", accountLabel: "TVA collectée", debit: 0, credit: devis.totalTVA }] : []),
          // Le droit de timbre entre dans le TTC porté au débit du client : sans
          // sa contrepartie au crédit (447), l'écriture était déséquilibrée de
          // 500 XOF exactement, et la conversion échouait sur le contrôle
          // d'équilibre. La création directe de facture, elle, portait déjà
          // cette ligne — la conversion l'avait oubliée.
          ...(totalDTS > 0 ? [{ accountCode: "447000", accountLabel: "Droits de timbre", debit: 0, credit: totalDTS }] : []),
        ],
        linkedDocType: "invoice", linkedDocId: invoice._id, createdBy: auth.userId,
      }], { session });
    }

    return invoice;
  });

  await logAudit(auth, "CREATE", "invoices", {
    resourceId: result._id.toString(),
    metadata: { fromDevis: devis.number, type: invoiceType },
  });

  return ok({
    invoice: result,
    message: invoiceType === "proforma"
      ? `Facture proforma ${result.number} créée depuis le devis ${devis.number}`
      : `Facture définitive ${result.number} créée depuis le devis ${devis.number}`,
  });
});
