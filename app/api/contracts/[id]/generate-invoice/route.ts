import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, forbidden, ok, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { ContractModel } from "@/models/Contract";
import { InvoiceModel } from "@/models/Invoice";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { withTransaction } from "@/lib/db";
import { calculerTVA, calculerDTS, TVA_TAUX_STANDARD } from "@/lib/niger-fiscal";
import { nextDocumentNumber } from "@/lib/numbering";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import { saleEntryLines } from "@/lib/invoice-entry";
import { authCan } from "@/lib/role-resources";

export const POST = withAuth("contracts", "update", async (_req: NextRequest, auth: TokenPayload, params) => {
  // Les factures sont émises par la comptabilité.
  if (!authCan(auth, "invoices", "create")) return forbidden("Facturation réservée à la comptabilité et au gérant.");
  await connectDB();
  const contract = await ContractModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!contract) return notFound("Contrat introuvable");
  if (!contract.clientId) return badRequest("Le contrat doit être lié à un client");
  if (contract.amount <= 0) return badRequest("Le montant du contrat doit être supérieur à 0");

  const totalHT = contract.amount;
  const totalTVA = calculerTVA(totalHT, TVA_TAUX_STANDARD);
  const totalDTS = calculerDTS(totalHT + totalTVA);
  const totalTTC = totalHT + totalTVA + totalDTS;

  // Même correction que pour la conversion d'un devis : la numérotation vient
  // du compteur du tenant, tiré dans la transaction, et non d'un « dernier
  // numéro + 1 » qui ignorait le préfixe personnalisé et se dupliquait en cas
  // d'appels simultanés.
  const issueDate = new Date();
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);

  const result = await withTransaction(async (session) => {
    const number = await nextDocumentNumber(auth.tenantId, "invoice", { issueDate, session });
    const [invoice] = await InvoiceModel.create([{
      tenantId: auth.tenantId,
      number,
      clientId: contract.clientId,
      lines: [{
        description: `${contract.title} — ${contract.reference}`,
        quantity: 1, unitPrice: totalHT, tvaRate: TVA_TAUX_STANDARD, discount: 0,
        totalHT, totalTVA, totalTTC: totalHT + totalTVA,
      }],
      totalHT, totalTVA, totalDTS, totalTTC,
      paidAmount: 0,
      status: "draft",
      issueDate,
      dueDate,
      notes: `Généré automatiquement depuis contrat ${contract.reference}`,
      createdBy: auth.userId,
    }], { session });

    // Lier la facture au contrat
    contract.invoiceIds.push(invoice._id);
    contract.lastBilledDate = new Date();
    // Calculer prochaine échéance
    const nextDate = new Date();
    const freq = contract.billingFrequency;
    if (freq === "monthly") nextDate.setMonth(nextDate.getMonth() + 1);
    else if (freq === "quarterly") nextDate.setMonth(nextDate.getMonth() + 3);
    else if (freq === "biannual") nextDate.setMonth(nextDate.getMonth() + 6);
    else if (freq === "annual") nextDate.setFullYear(nextDate.getFullYear() + 1);
    contract.nextBillingDate = nextDate;
    await contract.save({ session });

    // Même écriture que toute facture : 411 = produits + TVA + droits de timbre (447),
    // sinon l'écriture est déséquilibrée dès qu'il y a un timbre.
    await AccountingEntryModel.create([{
      tenantId: auth.tenantId, journalCode: "VT", entryDate: issueDate,
      reference: number, label: `Facture contrat ${contract.reference}`,
      lines: await saleEntryLines(auth.tenantId, { clientId: contract.clientId, lines: [{ totalHT }], totalTVA, totalDTS, totalTTC }, session),
      linkedDocType: "invoice", linkedDocId: invoice._id, createdBy: auth.userId,
    }], { session });

    return invoice;
  });

  await logAudit(auth, "CREATE", "invoices", {
    resourceId: result._id.toString(),
    metadata: { fromContract: contract.reference },
  });

  return ok({ invoice: result, message: `Facture ${result.number} générée depuis le contrat ${contract.reference}` });
});
