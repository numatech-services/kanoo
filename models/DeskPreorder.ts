import { Schema, model, models, Types } from "mongoose";

/**
 * Pré-commande passée dans l'appli EasyPay (plat premium, formule…), pour un
 * jour de retrait. Sert au plan de production ; le retrait arrive ensuite
 * comme une vente. Une ligne par commande, mise à jour à chaque changement
 * d'état (le plus récent l'emporte).
 */
export interface IDeskPreorder {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  deskId: Types.ObjectId;
  source: string;
  externalId: string;
  status: "booked" | "ready" | "picked_up" | "cancelled" | "no_show";
  pickupDay: string;
  service?: string;
  amount?: number;
  lines: Array<{ itemId: Types.ObjectId; quantity: number }>;
  /** Heure de l'état reçu (un état plus ancien, arrivé en retard, ne l'écrase pas). */
  statusAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DeskPreorderSchema = new Schema<IDeskPreorder>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
  deskId: { type: Schema.Types.ObjectId, ref: "ActivityDesk", required: true },
  source: { type: String, required: true, maxlength: 30 },
  externalId: { type: String, required: true, maxlength: 64 },
  status: { type: String, enum: ["booked", "ready", "picked_up", "cancelled", "no_show"], required: true },
  pickupDay: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  service: { type: String, maxlength: 30 },
  amount: { type: Number, min: 0 },
  lines: [{ _id: false, itemId: { type: Schema.Types.ObjectId, ref: "ActivityItem", required: true }, quantity: { type: Number, required: true, min: 0 } }],
  statusAt: { type: Date, required: true },
}, { timestamps: true });

DeskPreorderSchema.index({ tenantId: 1, source: 1, externalId: 1 }, { unique: true });
DeskPreorderSchema.index({ tenantId: 1, deskId: 1, pickupDay: 1, status: 1 });

export const DeskPreorderModel = models.DeskPreorder || model<IDeskPreorder>("DeskPreorder", DeskPreorderSchema);
