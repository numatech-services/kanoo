import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, created, badRequest, notFound, conflict, tenantFilter, requireFields } from "@/lib/api-helpers";
import { FrameworkOrderModel } from "@/models/FrameworkOrder";
import { DeliveryLotModel } from "@/models/DeliveryLot";
import { ProductModel } from "@/models/Product";
import { applyMovement } from "@/lib/stock";
import { BusinessRuleError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { canDeliver, inputConsumption, isFullyCompleted } from "@/lib/framework-order";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const GET = withAuth("commandes", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const lots = await DeliveryLotModel.find({ ...tenantFilter(auth), frameworkOrderId: params.id })
    .sort({ date: -1 }).lean();
  return ok({ items: lots });
});

/**
 * POST /api/marches-cadres/:id/lots — livrer une tranche.
 *
 * Tout se fait dans une transaction :
 *   1. le garde-fou refuse de livrer au-delà du reste (recontrôlé en base) ;
 *   2. le stock d'intrants est décrémenté (un numéro ISIC par carte, p.ex.) ;
 *   3. `deliveredQuantity` du marché est incrémenté — l'incrément conditionnel
 *      empêche deux lots simultanés de dépasser ensemble la commande.
 */
export const POST = withAuth("commandes", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const err = requireFields(body, ["quantity"]);
  if (err) return badRequest(err);
  const quantity = Number(body.quantity);

  const order = await FrameworkOrderModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!order) return notFound("Marché introuvable");

  const check = canDeliver(order, quantity);
  if (!check.ok) return badRequest(check.message);

  // Vérification du stock d'intrants avant d'écrire quoi que ce soit.
  const needed = inputConsumption(order, quantity);
  let inputProduct: { _id: unknown; stockQty: number; label: string } | null = null;
  if (order.inputProductId) {
    inputProduct = await ProductModel.findOne({ _id: order.inputProductId, ...tenantFilter(auth) })
      .select("stockQty label").lean<{ _id: unknown; stockQty: number; label: string } | null>();
    if (!inputProduct) return badRequest("L'intrant du marché est introuvable.");
    if ((inputProduct.stockQty || 0) < needed) {
      return conflict(`Stock d'intrant insuffisant : ${inputProduct.stockQty} disponible(s), ${needed} nécessaire(s) pour ce lot.`);
    }
  }

  const reference = String(body.reference || "").trim()
    || await nextDocumentNumber(auth.tenantId, "delivery", { issueDate: body.date });

  const lot = await withTransaction(async (session) => {
    // Incrément conditionnel : n'aboutit que si le reste est toujours suffisant.
    const guard = await FrameworkOrderModel.updateOne(
      { _id: order._id, ...tenantFilter(auth),
        $expr: { $lte: [{ $add: ["$deliveredQuantity", quantity] }, "$totalQuantity"] } },
      { $inc: { deliveredQuantity: quantity } },
      { session }
    );
    if (guard.modifiedCount === 0) {
      throw new BusinessRuleError("Un autre lot est intervenu : le reste à livrer a changé. Rechargez.");
    }

    // Consommation d'intrant : sortie de l'entrepôt choisi (défaut sinon),
    // lots pris par péremption la plus proche ; refusée si l'entrepôt manque.
    if (order.inputProductId && needed > 0) {
      await applyMovement({
        tenantId: auth.tenantId, userId: auth.userId, productId: order.inputProductId,
        type: "exit", quantity: needed, warehouseId: body.warehouseId || undefined,
        lots: Array.isArray(body.lots) ? body.lots : undefined,
        reason: `Livraison lot ${reference} — marché ${order.reference}`,
        linkedDocType: "delivery", linkedDocNumber: reference,
      }, session);
    }

    const [createdLot] = await DeliveryLotModel.create([{
      tenantId: auth.tenantId,
      frameworkOrderId: order._id,
      clientId: order.clientId,
      reference,
      date: body.date ? new Date(body.date) : new Date(),
      quantity,
      status: "delivered",
      inputConsumed: needed,
      notes: body.notes,
      createdBy: auth.userId,
    }], { session });

    return createdLot;
  });

  // Clôture automatique si tout est livré et facturé.
  const fresh = await FrameworkOrderModel.findById(order._id)
    .lean<{ status?: string; totalQuantity: number; deliveredQuantity?: number; invoicedQuantity?: number; unitPrice: number } | null>();
  if (fresh && isFullyCompleted(fresh) && fresh.status !== "completed") {
    await FrameworkOrderModel.updateOne({ _id: order._id }, { $set: { status: "completed" } });
  }

  await logAudit(auth, "CREATE", "commandes", { resourceId: String(order._id), metadata: { lot: String(lot._id), quantity } });
  return created(lot);
});
