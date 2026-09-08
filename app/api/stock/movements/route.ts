import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { 
  withAuth, 
  created, 
  badRequest, 
  tenantFilter, 
  requireFields, serverError } from "@/lib/api-helpers";
import { StockMovementModel } from "@/models/StockMovement";
import { ProductModel } from "@/models/Product";
import { logAudit } from "@/lib/audit";

export const POST = withAuth("products", "update", async (req: NextRequest, auth) => {
  await connectDB();
  
  try {
    const body = await req.json();

    // 1. Validation stricte
    const err = requireFields(body, ["productId", "type", "quantity", "reason"]);
    if (err) return badRequest(err);

    // 2. Trouver le produit
    const product = await ProductModel.findOne({
      _id: body.productId,
      ...tenantFilter(auth)
    });

    if (!product) {
      return NextResponse.json({ error: "Produit introuvable" }, { status: 404 });
    }

    // 3. Calcul du nouveau stock
    // - entrée / retour : on ajoute ;  sortie / perte : on retire.
    // - ajustement d'inventaire : la quantité saisie EST le stock réel constaté
    //   (le mouvement enregistré est l'écart). Auparavant « adjustment » n'était
    //   pas reconnu comme positif et diminuait donc toujours le stock.
    const qty = Math.abs(Number(body.quantity));
    const initialQty = product.stockQty || 0;
    let delta: number, finalQty: number;
    if (body.type === "adjustment") {
      finalQty = qty;
      delta = qty - initialQty;
    } else {
      delta = ["entry", "return"].includes(body.type) ? qty : -qty;
      finalQty = initialQty + delta;
    }
    if (finalQty < 0) return badRequest("Stock insuffisant pour cette sortie.");

    // 4. Enregistrement séquentiel (Plus fiable que transaction en local)
    const movement = await StockMovementModel.create({
      productId: product._id,
      tenantId: auth.tenantId,
      type: body.type,
      quantity: delta,
      quantityBefore: initialQty,
      quantityAfter: finalQty,
      reason: body.reason,
      createdBy: auth.userId,
    });

    // Mise à jour du produit
    product.stockQty = finalQty;
    await product.save();

    // 5. Audit
    await logAudit(auth, "UPDATE", "stock", {
      resourceId: body.productId,
      after: { stockQty: finalQty, type: body.type }
    });

    return created({ movementId: movement._id, newQty: finalQty, previousQty: initialQty });

  } catch (error) {
    // Le message interne partait au client : chemins, contraintes Mongo.
    return serverError(error);
  }
});