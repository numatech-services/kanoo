import { Schema, model, models } from "mongoose";

/**
 * Marché-cadre : une quantité annuelle commandée par un client, livrée par lots.
 *
 * `deliveredQuantity` et `invoicedQuantity` sont dénormalisés — mis à jour dans
 * la transaction qui crée un lot ou une facture — pour que le contrôle « on ne
 * livre/facture pas au-delà de la commande » ne dépende pas d'une agrégation à
 * chaque écriture. L'invariant : commandé ≥ livré ≥ facturé.
 */
const FrameworkOrderSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    reference: { type: String, required: true },
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true },
    title: { type: String, required: true },

    /** Produit fini livré (facultatif : le titre peut suffire). */
    productId: { type: Schema.Types.ObjectId, ref: "Product" },
    unit: { type: String, default: "unité" },

    totalQuantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    tvaRate: { type: Number, default: 0.19 },

    startDate: Date,
    endDate: Date,

    /** Intrant consommé du stock à chaque livraison (ex. numéro ISIC). */
    inputProductId: { type: Schema.Types.ObjectId, ref: "Product" },
    inputPerUnit: { type: Number, default: 1, min: 0 },

    status: { type: String, enum: ["draft", "active", "completed", "cancelled"], default: "active" },

    deliveredQuantity: { type: Number, default: 0, min: 0 },
    invoicedQuantity: { type: Number, default: 0, min: 0 },

    notes: String,
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

FrameworkOrderSchema.index({ tenantId: 1, reference: 1 }, { unique: true });
FrameworkOrderSchema.index({ tenantId: 1, clientId: 1, status: 1 });

export const FrameworkOrderModel = models.FrameworkOrder || model("FrameworkOrder", FrameworkOrderSchema);
