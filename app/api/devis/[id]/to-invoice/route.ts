import { NextRequest } from "next/server";
import { invoiceTerms } from "@/lib/doc-mentions";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, conflict, forbidden, tenantFilter } from "@/lib/api-helpers";
import { DevisModel } from "@/models/Devis";
import { InvoiceModel } from "@/models/Invoice";
import { withTransaction } from "@/lib/db";
import { calculerDTS } from "@/lib/niger-fiscal";
import { provisionalNumber } from "@/lib/numbering";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import { authCan } from "@/lib/role-resources";
import { copyMentions } from "@/lib/doc-mentions";

// POST /api/devis/:id/to-invoice
// Transforme un devis accepté en facture ; body.type=proforma rend le lien du PDF proforma (rien en base)
export const POST = withAuth("devis", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  // Le devis accepté est transformé en facture par la comptabilité (ou le gérant) :
  // la facture engage le chiffre d'affaires et les encaissements.
  if (!authCan(auth, "invoices", "create")) {
    return forbidden("La facture est émise par la comptabilité : transmettez-lui le devis accepté.");
  }
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const invoiceType = body.type || "invoice"; // "invoice" | "proforma"

  const devis = await DevisModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!devis) return notFound("Devis introuvable");
  // Proforma : un document d'engagement, pas une facture. Elle ne crée rien en
  // base (elle prenait un numéro de facture, apparaissait comme une facture
  // sans écriture et bloquait la vraie conversion du devis).
  if (invoiceType === "proforma") {
    return ok({ message: "Proforma prête : le PDF s'ouvre dans un nouvel onglet.", pdfUrl: `/api/devis/${devis._id}/pdf?proforma=1` });
  }
  if (devis.contractId) return conflict("Ce devis est devenu un marché : facturez-le depuis la fiche du marché (acomptes, échéances).");
  if (!["accepted", "sent", "draft"].includes(devis.status)) {
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
    // Brouillon : numéro définitif attribué à l'émission.
    const number = provisionalNumber();
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
      notes: `Convertie depuis devis ${devis.number}`,
      // Mentions et conditions du devis reprises telles quelles sur la facture.
      ...copyMentions(devis),
      // Conditions du devis, sans ce qui ne vaut que pour une offre (validité, nature de proforma).
      ...(invoiceTerms(devis.termsAndConditions) ? { termsAndConditions: invoiceTerms(devis.termsAndConditions) } : {}),
      ...(devis.projectId ? { projectId: devis.projectId } : {}),
      createdBy: auth.userId,
    }], { session });

    // Marquer le devis comme converti
    devis.convertedToInvoiceId = invoice._id;
    devis.status = "accepted";
    await devis.save({ session });

    // Brouillon : l'écriture de vente sera passée à l'émission.
    return invoice;
  });

  await logAudit(auth, "CREATE", "invoices", {
    resourceId: result._id.toString(),
    metadata: { fromDevis: devis.number, type: invoiceType },
  });

  return ok({
    invoice: result,
    message: `Facture définitive ${result.number} créée depuis le devis ${devis.number}`,
  });
});
