import { Schema, model, models } from "mongoose";

const DeliveryLineSchema = new Schema({
  invoiceLineIndex: { type: Number },
  description: { type: String, required: true },
  quantity: { type: Number, required: true, min: 0 },
  unit: { type: String, default: "unité" },
  productId: { type: Schema.Types.ObjectId, ref: "Product" },
  serialNumber: String,
  notes: String,
}, { _id: false });

const DeliveryNoteSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  number: { type: String, required: true },

  // Liens
  invoiceId: { type: Schema.Types.ObjectId, ref: "Invoice", required: true },
  clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true },

  // Contenu
  lines: { type: [DeliveryLineSchema], required: true },

  // Dates
  deliveryDate: { type: Date, required: true },
  deliveryAddress: String,

  // Statut
  status: {
    type: String,
    enum: ["draft", "issued", "delivered", "partially_delivered", "returned"],
    default: "draft",
  },
  signedAt: Date,
  signedBy: String, // Nom du réceptionnaire

  // Notes
  notes: String,
  internalNotes: String,

  createdBy: { type: Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });

DeliveryNoteSchema.index({ tenantId: 1, invoiceId: 1 });
DeliveryNoteSchema.index({ tenantId: 1, number: 1 }, { unique: true });
DeliveryNoteSchema.index({ tenantId: 1, status: 1 });

export const DeliveryNoteModel = models.DeliveryNote || model("DeliveryNote", DeliveryNoteSchema);
