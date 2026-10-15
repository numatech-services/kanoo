import { Schema, model, models } from "mongoose";
import { ITenant } from "@/types";

const TenantSchema = new Schema<ITenant>(
  {
    type: { type: String, enum: ["pme", "association", "administration"], required: true },
    name: { type: String, required: true, trim: true },
    // L'unicité est déclarée une seule fois, par TenantSchema.index() plus bas.
    // La cumuler avec `unique: true` crée un index en double, que Mongoose
    // signalait à chaque démarrage.
    slug: { type: String, required: true, lowercase: true },
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
    /**
     * Modules optionnels que l'organisation n'exerce pas (comptoir, isic,
     * licences, evenements) : retirés du menu et de la recherche. Vide par
     * défaut — tout est visible. Voir lib/modules.ts.
     */
    disabledModules: { type: [String], default: [] },
    /** Compte de trésorerie qui reçoit les paiements en ligne (mobile money via PayDunya) des factures. */
    onlinePaymentAccountId: { type: Schema.Types.ObjectId, ref: "TreasuryAccount" },
    /** Objectif mensuel de chiffre d'affaires facturé (TTC), jauge du tableau de bord. */
    monthlyRevenueTarget: { type: Number, min: 0 },
    subscriptionStatus: {
      type: String,
      enum: ["pending_activation", "trial", "active", "suspended", "cancelled", "none"],
      default: "trial",
    },
    trialEndsAt: Date,
    subscriptionEndsAt: Date,
    activatedAt: Date,
    activationToken: String,
    activationTokenExpiry: Date,
    /**
     * Identité visuelle des documents (factures, devis, courriers, réponses
     * aux appels d'offres). Chaque organisation personnalise ce qui apparaît en
     * en-tête, en pied, et les couleurs. Le logo est stocké au niveau `logo`
     * (URL ou data-URI). Tout est optionnel : sans réglage, des valeurs par
     * défaut sobres s'appliquent.
     */
    branding: {
      primaryColor: { type: String, default: "#2F3E46" },
      secondaryColor: { type: String, default: "#C9B79C" },
      /** Afficher le logo en tête de document. */
      showLogo: { type: Boolean, default: true },
      /** Slogan ou raison sociale complète, sous le nom. */
      tagline: String,
      /** Mentions légales en pied de page (RCCM, capital, siège…). */
      legalFooter: String,
      /** Comment régler : coordonnées bancaires, Orange/Moov/Airtel Money. */
      paymentInstructions: String,
      /** Conditions par défaut ajoutées aux devis/factures. */
      defaultTerms: String,
      /** Apposer un QR de vérification sur les documents générés. */
      documentQr: { type: Boolean, default: true },
      /** Disposition de l'en-tête : logo à gauche + infos à droite, ou centré. */
      headerLayout: { type: String, enum: ["left", "centered"], default: "left" },
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

    /** Identité de facturation certifiée (SECeF Niger). */
    secef: {
      /** Identifiant du Système de Facturation, délivré à l'agrément. */
      isf: String,
      /** MCF rattaché : boîtier, unité de facturation ou compte e-MCF. */
      mcfId: String,
      /** Date d'obtention du certificat de conformité. */
      certifiedSince: Date,
    },

    /**
     * Consommation de l'assistant IA rédactionnel — quota mensuel par
     * organisation. `month` est au format « AAAA-MM » ; le compteur repart à
     * zéro dès qu'un mois différent est constaté (réservation atomique côté
     * lib/ai-quota). `monthlyQuota` surcharge le plafond global (AI_MONTHLY_QUOTA)
     * pour cette organisation ; à `null`, c'est le plafond global qui s'applique.
     */
    aiUsage: {
      month: String,
      count: { type: Number, default: 0 },
      monthlyQuota: { type: Number, default: null },
    },
  },
  { timestamps: true }
);

// ─── Configuration de numérotation ─────────────────────────────────────────
// Chaque tenant peut personnaliser ses préfixes de numérotation
// et optionnellement spécifier le prochain numéro de séquence (utile pour migration)
TenantSchema.add({
  /**
   * Règles de frais de l'organisation.
   *
   * `mileageRate` n'a pas de valeur par défaut : le Niger ne publie pas de
   * barème kilométrique officiel, et en inventer un ferait passer un chiffre
   * arbitraire pour une référence opposable. Tant qu'il n'est pas fixé, la
   * saisie au kilomètre est refusée.
   */
  expensePolicy: {
    /** Plafonds par nature. Un dépassement est signalé, jamais bloqué. */
    caps: { type: Map, of: Number, default: undefined },
    mileageRate: Number,
    receiptThreshold: { type: Number, default: 5000 },
    maxAgeDays: { type: Number, default: 90 },
    vatRate: { type: Number, default: 0.19 },
  },

  /** Comptabilité verrouillée jusqu'à cette date incluse (clôture de période / d'exercice). */
  accountingLockedUntil: Date,
  /** Exercices clôturés (à-nouveaux générés). */
  closedFiscalYears: { type: [Number], default: [] },
  numberingConfig: {
    invoicePrefix:   { type: String, default: "FAC" },   // Ex: "NML" → NML-2025-00001
    quotePrefix:     { type: String, default: "DEV" },
    orderPrefix:     { type: String, default: "BC" },
    deliveryPrefix:  { type: String, default: "BL" },
    contractPrefix:  { type: String, default: "CTR" },
    creditNotePrefix: { type: String, default: "AV" },
    purchasePrefix:  { type: String, default: "ACH" },
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
    creditNoteSequence: { type: Number, default: 0 },
    purchaseSequence: { type: Number, default: 0 },
    // Pour migration : numéro de départ personnalisé
    invoiceStartAt:   { type: Number, default: 1 },
  },
});

TenantSchema.index({ slug: 1 }, { unique: true });
TenantSchema.index({ subscriptionStatus: 1 });

export const TenantModel = models.Tenant || model<ITenant>("Tenant", TenantSchema);
