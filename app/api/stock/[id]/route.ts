import { NextRequest } from "next/server";
import { withAuth, ok, notFound, tenantFilter, badRequest } from "@/lib/api-helpers";
import { CommandeModel } from "@/models/Commande";
import { ProductModel } from "@/models/Product";
import { StockMovementModel } from "@/models/StockMovement";
import { connectDB, withTransaction } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("commandes", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const c = await CommandeModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .populate("supplierId", "name code")
    .lean();
  if (!c) return notFound();
  return ok(c);
});

export const PATCH = withAuth("commandes", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json();

  // 1. Récupérer l'état actuel avant modification
  const oldDoc = await CommandeModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!oldDoc) return notFound();

  // 2. Exécuter la mise à jour dans une transaction pour garantir la cohérence Stock/Commande
  const result = await withTransaction(async (session) => {
    // Mise à jour de la commande
    const updatedCmd = await CommandeModel.findOneAndUpdate(
      { _id: params.id, ...tenantFilter(auth) },
      { $set: body },
      { new: true, session }
    );

    // 3. DÉCLENCHEUR DE STOCK : Si le statut passe à "received"
    if (oldDoc.status !== "received" && body.status === "received") {
      for (const line of updatedCmd.lines) {
        // On ne traite que les lignes qui ont un productId lié au catalogue
        if (line.productId) {
          const product = await ProductModel.findById(line.productId).session(session);
          
          if (product) {
            const qtyBefore = product.stockQty;
            const qtyToAdd = Number(line.quantity);
            const qtyAfter = qtyBefore + qtyToAdd;

            // Création du mouvement de stock
            await StockMovementModel.create([{
              productId: product._id,
              type: "entry",
              quantity: qtyToAdd,
              quantityBefore: qtyBefore,
              quantityAfter: qtyAfter,
              reason: `Réception automatique BC ${updatedCmd.number}`,
              tenantId: auth.tenantId,
              createdBy: auth.userId
            }], { session });

            // Mise à jour de la quantité sur le produit
            product.stockQty = qtyAfter;
            await product.save({ session });
          }
        }
      }
    }

    return updatedCmd;
  });

 await logAudit(auth, "UPDATE", "commandes", { 
  resourceId: params.id, 
  metadata: {
    statusChanged: oldDoc.status !== result.status 
  }
});

return ok(result);
});
