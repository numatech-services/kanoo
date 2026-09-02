import { Schema, model, models } from "mongoose";
import { IInvoice } from "@/types";

const InvoiceLineSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product" },
    description: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    tvaRate: { type: Number, default: 0.19 },
    discount: { type: Number, default: 0, min: 0, max: 100 },
    totalHT: { type: Number, required: true },
    totalTVA: { type: Number, required: true },
    totalTTC: { type: Number, required: true },
  },
  { _id: false }
);

const InvoiceSchema = new Schema<IInvoice>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    number: { type: String, required: true },
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true },
    quoteId: { type: Schema.Types.ObjectId, ref: "Devis" },
    lines: { type: [InvoiceLineSchema], required: true },
    totalHT: { type: Number, required: true },
    totalTVA: { type: Number, required: true },
    totalDTS: { type: Number, default: 0 },         // Droits de timbre Niger
    totalTTC: { type: Number, required: true },
    retenueSource: { type: Number, default: 0 },    // Retenue à la source marchés publics
    status: {
      type: String,
      enum: ["draft", "sent", "partial", "paid", "overdue", "cancelled"],
      default: "draft",
    },
    issueDate: { type: Date, required: true },
    dueDate: { type: Date, required: true },
    paidAmount: { type: Number, default: 0 },
    notes: String,
    termsAndConditions: String,
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

InvoiceSchema.index({ tenantId: 1, number: 1 }, { unique: true });
InvoiceSchema.index({ tenantId: 1, status: 1 });
InvoiceSchema.index({ tenantId: 1, clientId: 1 });
InvoiceSchema.index({ tenantId: 1, dueDate: 1 });

export const InvoiceModel = models.Invoice || model<IInvoice>("Invoice", InvoiceSchema);
