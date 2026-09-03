import { Schema, model, models } from "mongoose";
const TreasuryAccountSchema = new Schema({ tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true }, type: { type: String, enum: ["bank","cash","mobile_money"], required: true }, label: { type: String, required: true }, accountNumber: String,   /**
   * @deprecated Solde figé, jamais mis à jour par aucune route. Conservé pour
   * la reprise des comptes créés avant le module de mouvements : il sert alors
   * de solde d'ouverture. Le solde courant se calcule (voir lib/reconciliation).
   */
  balance: { type: Number, default: 0 },
  /** Solde à la date d'ouverture du suivi. Point de départ du calcul. */
  openingBalance: { type: Number, default: 0 },
  openingDate: Date, currency: { type: String, default: "XOF" }, isActive: { type: Boolean, default: true } }, { timestamps: true });
export const TreasuryAccountModel = models.TreasuryAccount || model("TreasuryAccount", TreasuryAccountSchema);
