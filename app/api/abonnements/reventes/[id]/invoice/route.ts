import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, created, badRequest, notFound, forbidden, tenantFilter } from "@/lib/api-helpers";
import { SubscriptionSaleModel } from "@/models/SubscriptionSale";
import { InvoiceModel } from "@/models/Invoice";
import { calculerTVA } from "@/lib/niger-fiscal";
import { provisionalNumber } from "@/lib/numbering";
import { authCan } from "@/lib/role-resources";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST — facture (brouillon) d'une revente d'abonnement : licences × prix
 * unitaire HT, TVA de la revente, période vendue dans le libellé. La revente
 * est liée à sa facture : l'alerte « non facturée » tombe. Aucune facture ne
 * pouvait être faite depuis une revente.
 */
export const POST = withAuth("subscriptions", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  if (!authCan(auth, "invoices", "create")) return forbidden("Facturation réservée à la comptabilité et au gérant.");
  await connectDB();
  if (!Types.ObjectId.isValid(params.id)) return notFound("Revente introuvable");
  const sale = await SubscriptionSaleModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .lean<{ _id: Types.ObjectId; reference: string; clientId: Types.ObjectId; productName: string; description?: string; startDate: Date; endDate: Date; quantity: number; unitPrice: number; tvaRate?: number; status: string; invoiceId?: unknown } | null>();
  if (!sale) return notFound("Revente introuvable");
  if (sale.invoiceId) return badRequest("Revente déjà facturée.");
  if (["draft", "cancelled"].includes(sale.status)) return badRequest("Revente en brouillon ou annulée : rien à facturer.");
  const rate = sale.tvaRate ?? 0.19;
  const unit = Math.round(sale.unitPrice);
  const totalHT = Math.round(unit * sale.quantity);
  const totalTVA = calculerTVA(totalHT, rate);
  const now = new Date(), due = new Date(); due.setDate(due.getDate() + 30);
  const period = `${new Date(sale.startDate).toLocaleDateString("fr-FR")} → ${new Date(sale.endDate).toLocaleDateString("fr-FR")}`;

  const invoice = await withTransaction(async session => {
    const [inv] = await InvoiceModel.create([{
      tenantId: auth.tenantId, number: provisionalNumber(), clientId: sale.clientId,
      lines: [{
        description: `${sale.productName} — ${sale.quantity} licence(s), période ${period}${sale.description ? ` (${sale.description})` : ""}`.slice(0, 500),
        quantity: sale.quantity, unit: "licence", unitPrice: unit, tvaRate: rate, discount: 0,
        totalHT, totalTVA, totalTTC: totalHT + totalTVA,
      }],
      totalHT, totalTVA, totalDTS: 0, totalTTC: totalHT + totalTVA, paidAmount: 0, status: "draft",
      issueDate: now, dueDate: due, notes: `Revente d'abonnement ${sale.reference}`, createdBy: auth.userId,
    }], { session });
    const claim = await SubscriptionSaleModel.updateOne({ _id: sale._id, invoiceId: { $exists: false } }, { $set: { invoiceId: inv._id, invoicedAt: now } }, { session });
    if (claim.modifiedCount !== 1) throw new BusinessRuleError("Revente déjà facturée.");
    return inv;
  });
  await logAudit(auth, "CREATE", "invoices", { resourceId: String(invoice._id), metadata: { fromResale: sale.reference } });
  return created({ invoice });
});
