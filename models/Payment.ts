import { Schema, model, models } from "mongoose";
import { IPayment } from "@/types";
const PaymentSchema = new Schema<IPayment>({ tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true }, invoiceId: { type: Schema.Types.ObjectId, ref: "Invoice", required: true }, amount: { type: Number, required: true, min: 0 }, method: { type: String, enum: ["cash","bank_transfer","cheque","mobile_money","other"], required: true }, reference: String, date: { type: Date, required: true }, notes: String,
  /**
   * Compte de trésorerie encaissé. Sans lui, un règlement n'alimentait aucun
   * solde : la trésorerie affichait un nombre saisi que rien ne mettait à jour.
   * Optionnel pour les paiements enregistrés avant ce module.
   */
  treasuryAccountId: { type: Schema.Types.ObjectId, ref: "TreasuryAccount", index: true },
  /**
   * « effective » = encaissé : impacte la facture, la comptabilité et la
   * trésorerie. « pending » = en attente : simple promesse enregistrée, aucun
   * effet comptable tant qu'il n'est pas confirmé. Défaut « effective » pour ne
   * pas modifier le comportement des règlements déjà saisis.
   */
  status: { type: String, enum: ["pending", "effective", "cancelled"], default: "effective", index: true },
  cancelledAt: Date,
  cancelReason: String,
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true } }, { timestamps: true });
PaymentSchema.index({ tenantId: 1, invoiceId: 1 });
export const PaymentModel = models.Payment || model<IPayment>("Payment", PaymentSchema);
