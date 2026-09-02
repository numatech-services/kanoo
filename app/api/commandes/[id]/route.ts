import { NextRequest } from "next/server";
import { withAuth, ok, notFound, tenantFilter, badRequest } from "@/lib/api-helpers";
import { CommandeModel } from "@/models/Commande";
import { ProductModel } from "@/models/Product";
import { StockMovementModel } from "@/models/StockMovement";
import { connectDB } from "@/lib/db";
import { calculerTVA } from "@/lib/niger-fiscal";

export const GET = withAuth("commandes", "read", async (_req, auth, params) => {
  await connectDB();
  // On s'assure que l'ID est propre
  const id = params.id;
  const c = await CommandeModel.findOne({ _id: id, ...tenantFilter(auth) })
    .populate("supplierId", "name code").lean();
  
  if (!c) return notFound(); 
  return ok(c);
});

export const PATCH = withAuth("commandes", "update", async (req, auth, params) => {
  await connectDB();
  try {
    const body = await req.json();
    const id = params.id;

    // 1. On récupère la commande AVANT pour voir si le statut change
    const oldDoc = await CommandeModel.findOne({ _id: id, ...tenantFilter(auth) });
    if (!oldDoc) return notFound();

    // 2. Mise à jour de la commande
    const updatedCmd = await CommandeModel.findOneAndUpdate(
      { _id: id, ...tenantFilter(auth) },
      { $set: body },
      { new: true }
    );

    if (!updatedCmd) return notFound();

    // 3. LOGIQUE STOCK : Uniquement si on passe de "autre chose" à "received"
    if (oldDoc.status !== "received" && body.status === "received") {
      console.log("Mise à jour du stock pour la commande :", updatedCmd.number);

      for (const line of updatedCmd.lines) {
        // IMPORTANT : Ton formulaire doit envoyer 'productId'
        const pId = line.productId; 
        
        if (pId) {
          const product = await ProductModel.findById(pId);
          if (product) {
            const delta = Number(line.quantity) || 0;
            const initialStock = product.stockQty || 0;

            // Créer le mouvement historique
            await StockMovementModel.create({
              productId: product._id,
              tenantId: auth.tenantId,
              type: "entry",
              quantity: delta,
              quantityBefore: initialStock,
              quantityAfter: initialStock + delta,
              reason: `Réception BC ${updatedCmd.number}`,
              createdBy: auth.userId,
            });

            // Mettre à jour le produit
            product.stockQty = initialStock + delta;
            await product.save();
            console.log(`Stock mis à jour pour ${product.label} : +${delta}`);
          }
        }
      }
    }

    return ok(updatedCmd);
  } catch (error: any) {
    console.error("Erreur API :", error);
    return badRequest(error.message);
  }
});