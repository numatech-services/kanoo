import { Schema, model, models } from "mongoose";
import { IClient } from "@/types";
const ClientSchema = new Schema<IClient>({ tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true }, code: { type: String, required: true }, name: { type: String, required: true, trim: true }, type: { type: String, enum: ["individual", "company"], default: "company" }, nif: String, rccm: String, email: String, phone: String, address: String,
  /** Lien du portail client : empreinte (recherche) et jeton chiffré (réaffichage, QR des PDF). Jamais renvoyés par défaut. */
  portalTokenHash: { type: String, select: false, index: true }, portalTokenEnc: { type: String, select: false }, portalLinkAt: Date, /** Logo propre du client (data-URI), affiché sur sa fiche et dans la liste.
   * Longueur bornée : ~150 Ko binaire ≈ 300 000 caractères base64, avec marge. */
  logo: { type: String, maxlength: [320_000, "Logo trop volumineux (150 Ko max)."] }, creditLimit: { type: Number, default: 0 }, /** @deprecated Jamais mis à jour : le solde est calculé (voir /api/clients et lib/statement.ts). */
  currentBalance: { type: Number, default: 0 }, paymentTermDays: { type: Number, default: 30 },
  /**
   * Nature du client : un acheteur public (État, collectivité, établissement
   * public, projet…) relève de la commande publique (enregistrement à 5 %) et
   * est exonéré de timbre-quittance. Voir lib/registration.
   */
  buyerType: { type: String, enum: ["state", "local_authority", "public_establishment", "sem", "project", "state_funded", "private", "ngo"], default: "private" },
  isActive: { type: Boolean, default: true }, notes: String }, { timestamps: true });
ClientSchema.index({ tenantId: 1, code: 1 }, { unique: true });
ClientSchema.index({ tenantId: 1, name: 1 });
export const ClientModel = models.Client || model<IClient>("Client", ClientSchema);

/** Champs jamais écrits par le formulaire client (lien du portail : route dédiée). */
export const CLIENT_PROTECTED = ["portalTokenHash", "portalTokenEnc", "portalLinkAt"];
