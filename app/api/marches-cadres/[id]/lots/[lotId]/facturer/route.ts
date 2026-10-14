import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, created, badRequest, notFound, conflict, tenantFilter } from "@/lib/api-helpers";
import { FrameworkOrderModel } from "@/models/FrameworkOrder";
import { DeliveryLotModel } from "@/models/DeliveryLot";
import { InvoiceModel } from "@/models/Invoice";
import { nextDocumentNumber } from "@/lib/numbering";
import { canInvoice, isFullyCompleted } from "@/lib/framework-order";
import { computeInvoiceLines } from "@/lib/invoice-entry";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

import { postInvoice } from "@/lib/invoice-posting";
export const dynamic = "force-dynamic";

/**
 * POST /api/marches-cadres/:id/lots/:lotId/facturer — facturer un lot livré.
 *
 * Crée une facture pour la quantité du lot au prix du marché, la lie au lot, et
 * incrémente `invoicedQuantity` — sans jamais facturer au-delà du livré, ni
 * facturer deux fois le même lot.
 */
export const POST = withAuth("invoices", "create", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));

  const [order, lot] = await Promise.all([
    FrameworkOrderModel.findOne({ _id: params.id, ...tenantFilter(auth) }),
    DeliveryLotModel.findOne({ _id: params.lotId, frameworkOrderId: params.id, ...tenantFilter(auth) }),
  ]);
  if (!order || !lot) return notFound("Marché ou lot introuvable");
  if (lot.invoiceId) return conflict("Ce lot est déjà facturé.");

  const check = canInvoice(order, lot.quantity);
  if (!check.ok) return badRequest(check.message);

  // Même calcul et même écriture que toute facture : lignes arrondies, droit de
  // timbre, écriture de vente (411 / 70x / 443 / 447). La facture de lot n'avait
  // ni timbre ni écriture : le règlement du client creusait le compte 411.
  const { lines, totalHT, totalTVA, totalDTS, totalTTC } = computeInvoiceLines([{
    description: `${order.title} — lot ${lot.reference} (${lot.quantity} ${order.unit})`,
    quantity: lot.quantity, unitPrice: order.unitPrice, tvaRate: order.tvaRate, discount: 0,
    ...(order.productId ? { productId: order.productId } : {}),
  }]);
  const issueDate = body.issueDate ? new Date(body.issueDate) : new Date();
  const dueDate = body.dueDate ? new Date(body.dueDate) : new Date(issueDate.getTime() + 30 * 86400000);

  const invoice = await withTransaction(async (session) => {
    // On ne facture pas au-delà du livré, même en cas d'appels concurrents.
    const guard = await FrameworkOrderModel.updateOne(
      { _id: order._id, ...tenantFilter(auth),
        $expr: { $lte: [{ $add: ["$invoicedQuantity", lot.quantity] }, "$deliveredQuantity"] } },
      { $inc: { invoicedQuantity: lot.quantity } },
      { session }
    );
    if (guard.modifiedCount === 0) throw new BusinessRuleError("Le livré facturable a changé entre-temps. Rechargez.");

    const number = await nextDocumentNumber(auth.tenantId, "invoice", { issueDate, session });
    const [inv] = await InvoiceModel.create([{
      tenantId: auth.tenantId,
      number,
      clientId: order.clientId,
      documentType: "invoice",
      issueDate, dueDate,
      lines, totalHT, totalTVA, totalDTS, totalTTC,
      paidAmount: 0, status: "sent",
      notes: `Facturation du lot ${lot.reference} au titre du marché ${order.reference}.`,
      createdBy: auth.userId,
    }], { session });

    // Facture émise d'emblée : comptabilisée tout de suite, par le chemin commun.
    await postInvoice({ tenantId: auth.tenantId, userId: auth.userId }, inv, session);

    await DeliveryLotModel.updateOne({ _id: lot._id },
      { $set: { status: "invoiced", invoiceId: inv._id } }, { session });
    return inv;
  });

  // Clôture automatique : la dernière facturation peut compléter le marché.
  const fresh = await FrameworkOrderModel.findById(order._id)
    .lean<{ status?: string; totalQuantity: number; deliveredQuantity?: number; invoicedQuantity?: number; unitPrice: number } | null>();
  if (fresh && isFullyCompleted(fresh) && fresh.status !== "completed") {
    await FrameworkOrderModel.updateOne({ _id: order._id }, { $set: { status: "completed" } });
  }

  await logAudit(auth, "CREATE", "invoices", { resourceId: String(invoice._id), metadata: { fromLot: String(lot._id) } });
  return created(invoice);
});
