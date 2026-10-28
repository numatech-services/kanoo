import { Schema, model, models } from "mongoose";

/**
 * Ligne du relevé d'un opérateur mobile money (Airtel, Moov, Zamani),
 * importée pour le rapprochement avec les encaissements du comptoir.
 */
const MobileMoneyLineSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  deskId: { type: Schema.Types.ObjectId, ref: "ActivityDesk", required: true },
  operator: { type: String, maxlength: 30 },
  date: { type: Date, required: true },
  amount: { type: Number, required: true },
  reference: { type: String, maxlength: 80 },
  phone: { type: String, maxlength: 30 },
  /** Encaissement du comptoir rapproché. */
  cashEntryId: { type: Schema.Types.ObjectId, ref: "ActivityCashEntry" },
  importedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

MobileMoneyLineSchema.index({ tenantId: 1, deskId: 1, date: -1 });
// Une même opération (référence) n'est importée qu'une fois.
MobileMoneyLineSchema.index({ tenantId: 1, deskId: 1, reference: 1 }, { unique: true, partialFilterExpression: { reference: { $type: "string" } } });

export const MobileMoneyLineModel = models.MobileMoneyLine || model("MobileMoneyLine", MobileMoneyLineSchema);
