import { Schema, model, models } from "mongoose";

/**
 * Lot de livraison : une tranche livrée au titre d'un marché-cadre.
 *
 * Chaque lot décrémente le stock d'intrants du marché (dans la même
 * transaction) et incrémente `deliveredQuantity` du marché. Le facturer plus
 * tard crée une facture et incrémente `invoicedQuantity`.
 */
const DeliveryLotSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    frameworkOrderId: { type: Schema.Types.ObjectId, ref: "FrameworkOrder", required: true, index: true },
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true },

    reference: { type: String, required: true },
    date: { type: Date, required: true, default: Date.now },
    quantity: { type: Number, required: true, min: 1 },

    status: { type: String, enum: ["delivered", "invoiced", "cancelled"], default: "delivered" },
    invoiceId: { type: Schema.Types.ObjectId, ref: "Invoice" },
    /** Intrants effectivement consommés par ce lot (trace figée). */
    inputConsumed: { type: Number, default: 0 },

    notes: String,
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

DeliveryLotSchema.index({ tenantId: 1, frameworkOrderId: 1, date: -1 });

export const DeliveryLotModel = models.DeliveryLot || model("DeliveryLot", DeliveryLotSchema);
