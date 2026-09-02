import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { 
  withAuth, 
  created, 
  badRequest, 
  tenantFilter, 
  requireFields 
} from "@/lib/api-helpers";
import { StockMovementModel } from "@/models/StockMovement";
import { ProductModel } from "@/models/Product";
import { logAudit } from "@/lib/audit";

export const POST = withAuth("products", "update", async (req: NextRequest, auth) => {
  await connectDB();
  
  try {
    const body = await req.json();
    console.log("📦 Nouveau mouvement reçu:", body);

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
    const qty = Math.abs(Number(body.quantity));
    const delta = ["entry", "return", "adjustment_pos"].includes(body.type) ? qty : -qty;
    const initialQty = product.stockQty || 0;
    const finalQty = initialQty + delta;

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

    console.log("✅ Stock mis à jour avec succès");

    // 5. Audit
    await logAudit(auth, "UPDATE", "stock", {
      resourceId: body.productId,
      after: { stockQty: finalQty, type: body.type }
    });

    return created({ success: true, newQty: finalQty });

  } catch (error: any) {
    console.error("🔥 Erreur API Stock:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});