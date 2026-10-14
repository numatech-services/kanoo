import { Schema, model, models } from "mongoose";
const TreasuryAccountSchema = new Schema({ tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true }, type: { type: String, enum: ["bank","cash","mobile_money"], required: true }, label: { type: String, required: true }, accountNumber: String,   /**
   * @deprecated Solde figé, jamais mis à jour par aucune route. Conservé pour
   * la reprise des comptes créés avant le module de mouvements : il sert alors
   * de solde d'ouverture. Le solde courant se calcule (voir lib/reconciliation).
   */
  balance: { type: Number, default: 0 },
  /** Solde à la date d'ouverture du suivi. Point de départ du calcul. */
  openingBalance: { type: Number, default: 0 },
  openingDate: Date, currency: { type: String, default: "XOF" }, isActive: { type: Boolean, default: true },
  /**
   * Compte comptable propre à ce compte de trésorerie (5211xx banque, 5218xx
   * mobile money, 5711xx caisse). Sans lui, toutes les banques écrivaient sur
   * 521000 et le grand livre ne permettait pas de rapprocher une banque précise.
   * Absent sur les comptes créés avant octobre 2026 tant qu'ils ne sont pas
   * reclassés (voir lib/treasury, assignLedgerCode).
   */
  ledgerCode: { type: String, match: /^5[27]\d{4}$/ } }, { timestamps: true });
export const TreasuryAccountModel = models.TreasuryAccount || model("TreasuryAccount", TreasuryAccountSchema);
