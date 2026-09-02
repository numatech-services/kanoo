import { Schema, model, models } from "mongoose";
import { ISupplier } from "@/types";
const SupplierSchema = new Schema<ISupplier>({ tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true }, code: { type: String, required: true }, name: { type: String, required: true, trim: true }, nif: String, email: String, phone: String, address: String, paymentTermDays: { type: Number, default: 30 }, bankName: String, bankAccount: String, isActive: { type: Boolean, default: true },
  // Le portail fournisseur filtrait sur un `accessCode` absent du schéma : la
  // requête ne pouvait jamais aboutir. Le champ existe désormais, haché.
  accessCodeHash: { type: String, select: false },
  accessCodeGeneratedAt: Date,
}, { timestamps: true });
SupplierSchema.index({ tenantId: 1, code: 1 }, { unique: true });
SupplierSchema.index({ email: 1 });
export const SupplierModel = models.Supplier || model<ISupplier>("Supplier", SupplierSchema);
