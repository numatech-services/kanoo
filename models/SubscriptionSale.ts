import { Schema, model, models } from "mongoose";

/**
 * Abonnement **revendu** à un client final.
 *
 * Rattaché à l'abonnement souscrit dont il consomme une part (`purchaseId`) :
 * c'est ce lien qui permet le rapprochement — combien de licences achetées,
 * combien placées, pour quelle marge, et sur quelle période.
 *
 * Une revente sans rattachement reste possible (prestation vendue sans contrat
 * amont), mais elle est signalée dans le rapprochement plutôt que passée sous
 * silence : une revente non adossée est soit une saisie incomplète, soit une
 * marge de 100 % qu'il vaut mieux vérifier.
 */
const SubscriptionSaleSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },

    reference: { type: String, required: true },

    /** Contrat amont consommé. Absent = revente non adossée. */
    purchaseId: { type: Schema.Types.ObjectId, ref: "SubscriptionPurchase", index: true },
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true },

    /** Ce que le client achète, tel qu'il figurera sur sa facture. */
    productName: { type: String, required: true, trim: true },
    description: String,

    // ── Période vendue ───────────────────────────────────────────────────
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    billingCycle: {
      type: String,
      enum: ["monthly", "quarterly", "biannual", "annual", "one_off"],
      default: "annual",
    },
    autoRenew: { type: Boolean, default: false },

    // ── Quantité et prix ─────────────────────────────────────────────────
    quantity: { type: Number, required: true, min: 1 },
    /** Prix unitaire HT en XOF. */
    unitPrice: { type: Number, required: true, min: 0 },
    /** Total HT en XOF — recalculé côté serveur, jamais repris du client. */
    totalHT: { type: Number, required: true, min: 0 },
    tvaRate: { type: Number, default: 0.19 },
    totalTVA: { type: Number, required: true, min: 0 },
    totalTTC: { type: Number, required: true, min: 0 },

    /**
     * Retenue à la source opérée par le client sur le règlement (marchés
     * publics notamment). Elle ampute l'encaissement sans réduire le produit.
     */
    withholdingAmount: { type: Number, default: 0, min: 0 },

    status: {
      type: String,
      enum: ["draft", "active", "expiring", "expired", "cancelled", "renewed"],
      default: "active",
    },

    /** Facture émise au client. Une revente non facturée est une alerte. */
    invoiceId: { type: Schema.Types.ObjectId, ref: "Invoice" },
    invoicedAt: Date,

    notes: String,
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

SubscriptionSaleSchema.index({ tenantId: 1, reference: 1 }, { unique: true });
SubscriptionSaleSchema.index({ tenantId: 1, clientId: 1 });
SubscriptionSaleSchema.index({ tenantId: 1, status: 1 });
SubscriptionSaleSchema.index({ tenantId: 1, endDate: 1 });

export const SubscriptionSaleModel =
  models.SubscriptionSale || model("SubscriptionSale", SubscriptionSaleSchema);
