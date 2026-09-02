import { Schema, model, models } from "mongoose";

/**
 * Abonnement **souscrit** par l'organisation auprès d'un éditeur ou d'un
 * fournisseur (Compilatio, Microsoft, un hébergeur…).
 *
 * C'est le stock : une quantité de licences achetée pour une période donnée,
 * que l'organisation consomme elle-même ou revend à des clients finaux (voir
 * SubscriptionSale). Le rapprochement entre ce qui est acheté et ce qui est
 * revendu est ce qui révèle la marge — et les sur-engagements.
 *
 * Devise : les éditeurs facturent souvent en EUR ou en USD. Le montant
 * d'origine est conservé tel quel avec son taux de change, et la contre-valeur
 * en XOF est figée à la souscription. Reconvertir au cours du jour ferait
 * varier une marge déjà réalisée.
 */
const SubscriptionPurchaseSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },

    reference: { type: String, required: true },

    /** Éditeur / fournisseur. Référence réelle, jamais un nom libre. */
    supplierId: { type: Schema.Types.ObjectId, ref: "Supplier", required: true },

    /** Nom commercial de l'abonnement chez l'éditeur. */
    productName: { type: String, required: true, trim: true },
    /** Référence du contrat côté éditeur, pour le rapprochement. */
    vendorContractRef: { type: String, trim: true },
    description: String,

    // ── Période ──────────────────────────────────────────────────────────
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    billingCycle: {
      type: String,
      enum: ["monthly", "quarterly", "biannual", "annual", "one_off"],
      default: "annual",
    },
    autoRenew: { type: Boolean, default: false },
    /** Préavis de résiliation, en jours. Sert au calcul de l'alerte. */
    noticeDays: { type: Number, default: 30, min: 0 },

    // ── Quantité et coût ─────────────────────────────────────────────────
    /** Nombre de licences, de comptes ou de crédits acquis. */
    quantity: { type: Number, required: true, min: 1 },
    unitLabel: { type: String, default: "licence" },

    /** Devise de facturation de l'éditeur. */
    currency: { type: String, enum: ["XOF", "EUR", "USD"], default: "XOF" },
    /** Montant tel que facturé par l'éditeur, dans sa devise. */
    sourceAmount: { type: Number, required: true, min: 0 },
    /** Taux appliqué à la souscription. 1 quand la devise est déjà le XOF. */
    exchangeRate: { type: Number, default: 1, min: 0 },
    /** Contre-valeur en francs CFA, figée. Base de tous les calculs de marge. */
    costAmount: { type: Number, required: true, min: 0 },

    // ── Charges fiscales liées à l'achat ─────────────────────────────────
    /**
     * Retenue à la source sur prestation de service (CGI art. 118) lorsque le
     * prestataire est établi hors du Niger. Montant en XOF, saisi ou calculé.
     */
    withholdingAmount: { type: Number, default: 0, min: 0 },
    /** TVA supportée ou auto-liquidée sur l'achat, en XOF. */
    purchaseVatAmount: { type: Number, default: 0, min: 0 },
    /** Frais annexes retenus par la banque sur un transfert international. */
    bankFeesAmount: { type: Number, default: 0, min: 0 },

    status: {
      type: String,
      enum: ["draft", "active", "expiring", "expired", "cancelled"],
      default: "active",
    },

    /** Facture fournisseur ou justificatif rattaché. */
    documentUrl: String,
    notes: String,

    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

SubscriptionPurchaseSchema.index({ tenantId: 1, reference: 1 }, { unique: true });
SubscriptionPurchaseSchema.index({ tenantId: 1, supplierId: 1 });
SubscriptionPurchaseSchema.index({ tenantId: 1, status: 1 });
// Les alertes d'échéance balaient par date de fin : index dédié.
SubscriptionPurchaseSchema.index({ tenantId: 1, endDate: 1 });

export const SubscriptionPurchaseModel =
  models.SubscriptionPurchase || model("SubscriptionPurchase", SubscriptionPurchaseSchema);
