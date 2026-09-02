import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { ContractModel } from "@/models/Contract";
import { InvoiceModel } from "@/models/Invoice";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { withTransaction } from "@/lib/db";
import { calculerTVA, calculerDTS, genererNumeroFacture } from "@/lib/niger-fiscal";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const POST = withAuth("contracts", "update", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const contract = await ContractModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!contract) return notFound("Contrat introuvable");
  if (!contract.clientId) return badRequest("Le contrat doit être lié à un client");
  if (contract.amount <= 0) return badRequest("Le montant du contrat doit être supérieur à 0");

  const totalHT = contract.amount;
  const totalTVA = calculerTVA(totalHT, 0.19);
  const totalDTS = calculerDTS(totalHT + totalTVA);
  const totalTTC = totalHT + totalTVA + totalDTS;

  const year = new Date().getFullYear();
  const lastInv = await InvoiceModel.findOne({ tenantId: auth.tenantId }).sort({ createdAt: -1 }).select("number").lean();
  const lastSeq = lastInv?.number ? parseInt(lastInv.number.split("-").at(-1) || "0") : 0;
  const number = genererNumeroFacture(year, lastSeq + 1);

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);

  const result = await withTransaction(async (session) => {
    const [invoice] = await InvoiceModel.create([{
      tenantId: auth.tenantId,
      number,
      clientId: contract.clientId,
      lines: [{
        description: `${contract.title} — ${contract.reference}`,
        quantity: 1, unitPrice: totalHT, tvaRate: 0.19, discount: 0,
        totalHT, totalTVA, totalTTC: totalHT + totalTVA,
      }],
      totalHT, totalTVA, totalDTS, totalTTC,
      paidAmount: 0,
      status: "draft",
      issueDate: new Date(),
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

    await AccountingEntryModel.create([{
      tenantId: auth.tenantId, journalCode: "VT", entryDate: new Date(),
      reference: number, label: `Facture contrat ${contract.reference}`,
      lines: [
        { accountCode: "411000", accountLabel: "Clients", debit: totalTTC, credit: 0, thirdPartyId: contract.clientId },
        { accountCode: "706000", accountLabel: "Prestations", debit: 0, credit: totalHT },
        ...(totalTVA > 0 ? [{ accountCode: "443000", accountLabel: "TVA collectée", debit: 0, credit: totalTVA }] : []),
      ],
      linkedDocType: "invoice", linkedDocId: invoice._id, createdBy: auth.userId,
    }], { session });

    return invoice;
  });

  await logAudit(auth, "CREATE", "invoices", {
    resourceId: result._id.toString(),
    metadata: { fromContract: contract.reference },
  });

  return ok({ invoice: result, message: `Facture ${number} générée depuis le contrat ${contract.reference}` });
});
