import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, forbidden, ok, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { ContractModel } from "@/models/Contract";
import { InvoiceModel } from "@/models/Invoice";
import { withTransaction } from "@/lib/db";
import { calculerTVA, calculerDTS, TVA_TAUX_STANDARD } from "@/lib/niger-fiscal";
import { provisionalNumber } from "@/lib/numbering";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import { authCan } from "@/lib/role-resources";
import { BusinessRuleError } from "@/lib/errors";

export const POST = withAuth("contracts", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  // Les factures sont émises par la comptabilité.
  if (!authCan(auth, "invoices", "create")) return forbidden("Facturation réservée à la comptabilité et au gérant.");
  await connectDB();
  const contract = await ContractModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!contract) return notFound("Contrat introuvable");
  if (!contract.clientId) return badRequest("Le contrat doit être lié à un client");
  if (contract.amount <= 0) return badRequest("Le montant du contrat doit être supérieur à 0");
  // Facture de PÉRIODE d'un contrat récurrent actif, une fois par échéance.
  // Sans ces contrôles, deux clics facturaient deux fois, sur n'importe quel
  // contrat (marché compris, hors plafond, retenue et acomptes).
  if (!contract.isRecurring) return badRequest("Contrat non récurrent : facturez depuis l'échéancier du marché.");
  if (!["active", "renewed"].includes(contract.status)) return badRequest("Seul un contrat actif se facture.");
  const due = contract.nextBillingDate ? new Date(contract.nextBillingDate) : null;
  const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
  if (due && due > endOfToday) return badRequest(`Période déjà facturée : prochaine échéance le ${due.toLocaleDateString("fr-FR")}.`);
  const body = await req.json().catch(() => ({}));
  const rate = body.tvaRate === undefined ? TVA_TAUX_STANDARD : Number(body.tvaRate);
  if (!(rate >= 0 && rate < 1)) return badRequest("Taux de TVA invalide (fraction : 0,19).");

  const totalHT = contract.amount;
  const totalTVA = calculerTVA(totalHT, rate);
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
    // Échéance réservée, gardée sur la valeur lue : le second clic ne la trouve plus.
    const claim = await ContractModel.updateOne(
      { _id: contract._id, nextBillingDate: contract.nextBillingDate ?? null },
      { $set: { lastBilledDate: new Date() } }, { session });
    if (claim.modifiedCount !== 1) throw new BusinessRuleError("Cette période vient d'être facturée.");
    // Brouillon : numéro définitif attribué à l'émission.
    const number = provisionalNumber();
    const [invoice] = await InvoiceModel.create([{
      tenantId: auth.tenantId,
      number,
      clientId: contract.clientId,
      // Rattachée au marché et à son projet : recette visible dans la rentabilité.
      contractId: contract._id,
      ...(contract.projectId ? { projectId: contract.projectId } : {}),
      lines: [{
        description: `${contract.title} — ${contract.reference}`,
        quantity: 1, unitPrice: totalHT, tvaRate: rate, discount: 0,
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
    // Prochaine échéance : à partir de l'échéance facturée, pas du jour du
    // clic (sinon elle dérive à chaque facture faite en retard ou en avance).
    const nextDate = new Date(due ?? new Date());
    const freq = contract.billingFrequency;
    if (freq === "monthly") nextDate.setMonth(nextDate.getMonth() + 1);
    else if (freq === "quarterly") nextDate.setMonth(nextDate.getMonth() + 3);
    else if (freq === "biannual") nextDate.setMonth(nextDate.getMonth() + 6);
    else if (freq === "annual") nextDate.setFullYear(nextDate.getFullYear() + 1);
    contract.nextBillingDate = nextDate;
    await contract.save({ session });

    // Brouillon : l'écriture de vente sera passée à l'émission.
    return invoice;
  });

  await logAudit(auth, "CREATE", "invoices", {
    resourceId: result._id.toString(),
    metadata: { fromContract: contract.reference },
  });

  return ok({ invoice: result, message: `Facture ${result.number} générée depuis le contrat ${contract.reference}` });
});
