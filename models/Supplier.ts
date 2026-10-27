import { Schema, model, models } from "mongoose";
import { ISupplier } from "@/types";
const SupplierSchema = new Schema<ISupplier>({ tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true }, code: { type: String, required: true }, name: { type: String, required: true, trim: true }, nif: String, rccm: String, email: String, phone: String, address: String, /** Logo propre du fournisseur (data-URI). Longueur bornée (~150 Ko binaire). */
  logo: { type: String, maxlength: [320_000, "Logo trop volumineux (150 Ko max)."] }, notes: String, paymentTermDays: { type: Number, default: 30 }, bankName: String, bankAccount: String, isActive: { type: Boolean, default: true },
  // Le portail fournisseur filtrait sur un `accessCode` absent du schéma : la
  // requête ne pouvait jamais aboutir. Le champ existe désormais, haché.
  accessCodeHash: { type: String, select: false },
  accessCodeGeneratedAt: Date,
}, { timestamps: true });
SupplierSchema.index({ tenantId: 1, code: 1 }, { unique: true });
SupplierSchema.index({ email: 1 });
export const SupplierModel = models.Supplier || model<ISupplier>("Supplier", SupplierSchema);

/** Champs jamais écrits par le formulaire fournisseur (code d'accès au portail : route dédiée). */
export const SUPPLIER_PROTECTED = ["accessCodeHash", "accessCodeGeneratedAt", "accessCode"];
