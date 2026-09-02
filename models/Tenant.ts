import mongoose, { Schema, model, models } from "mongoose";
import { ITenant } from "@/types";

const TenantSchema = new Schema<ITenant>(
  {
    type: { type: String, enum: ["pme", "association", "administration"], required: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    nif: { type: String, trim: true },
    rccm: { type: String, trim: true },
    address: String,
    phone: String,
    email: { type: String, lowercase: true },
    logo: String,
    plan: {
      type: String,
      enum: ["starter", "pro", "enterprise", "asso_basic", "asso_pro", "admin"],
      default: "starter",
    },
    planModules: { type: [String], default: ["*"] },
    subscriptionStatus: {
      type: String,
      enum: ["trial", "active", "suspended", "cancelled", "none"],
      default: "trial",
    },
    trialEndsAt: Date,
    subscriptionEndsAt: Date,
    activatedAt: Date,
    activationToken: String,
    activationTokenExpiry: Date,
    branding: {
      primaryColor: { type: String, default: "#2F3E46" },
      secondaryColor: { type: String, default: "#C9B79C" },
    },
    // Numérotation personnalisée — Q5
    documentPrefixes: {
      invoice:  { type: String, default: "FAC" },   // FAC-2025-00001
      devis:    { type: String, default: "DEV" },   // DEV-2025-00001
      commande: { type: String, default: "BC" },    // BC-2025-00001
      delivery: { type: String, default: "BL" },    // BL-2025-00001
      marche:   { type: String, default: "MRC" },   // MRC-2025-00001
      contract: { type: String, default: "CTR" },   // CTR-2025-00001
    },
    // Séquences de départ (migration depuis logiciel existant)
    documentSequences: {
      invoice:  { type: Number, default: 0 },
      devis:    { type: Number, default: 0 },
      commande: { type: Number, default: 0 },
      delivery: { type: Number, default: 0 },
    },
    // Préférence de langue — Q6
    preferredLanguage: { type: String, enum: ["fr", "en"], default: "fr" },
  },
  { timestamps: true }
);

// ─── Configuration de numérotation ─────────────────────────────────────────
// Chaque tenant peut personnaliser ses préfixes de numérotation
// et optionnellement spécifier le prochain numéro de séquence (utile pour migration)
TenantSchema.add({
  numberingConfig: {
    invoicePrefix:   { type: String, default: "FAC" },   // Ex: "NML" → NML-2025-00001
    quotePrefix:     { type: String, default: "DEV" },
    orderPrefix:     { type: String, default: "BC" },
    deliveryPrefix:  { type: String, default: "BL" },
    contractPrefix:  { type: String, default: "CTR" },
    separator:       { type: String, default: "-" },      // Ex: "/" → NML/2025/00001
    digitCount:      { type: Number, default: 5 },        // Nb de chiffres du séquençeur
    yearInNumber:    { type: Boolean, default: true },    // Inclure l'année
    resetYearly:     { type: Boolean, default: true },    // Réinitialiser au 1er janvier
    // Séquences courantes (incrémentées par les APIs)
    invoiceSequence:  { type: Number, default: 0 },
    quoteSequence:    { type: Number, default: 0 },
    orderSequence:    { type: Number, default: 0 },
    deliverySequence: { type: Number, default: 0 },
    contractSequence: { type: Number, default: 0 },
    // Pour migration : numéro de départ personnalisé
    invoiceStartAt:   { type: Number, default: 1 },
  },
});

TenantSchema.index({ slug: 1 }, { unique: true });
TenantSchema.index({ subscriptionStatus: 1 });

export const TenantModel = models.Tenant || model<ITenant>("Tenant", TenantSchema);
