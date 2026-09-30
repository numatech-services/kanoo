import { Schema, model, models } from "mongoose";
import { IInvoice } from "@/types";

const InvoiceLineSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product" },
    description: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    tvaRate: { type: Number, default: 0.19 },
    discount: { type: Number, default: 0, min: 0, max: 100 },
    totalHT: { type: Number, required: true },
    totalTVA: { type: Number, required: true },
    totalTTC: { type: Number, required: true },
  },
  { _id: false }
);

const InvoiceSchema = new Schema<IInvoice>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },

    /**
     * Nature du document.
     *
     * Une facture d'avoir partage la structure d'une facture — mêmes lignes,
     * mêmes totaux, même certification — mais s'en retranche. Elle est portée
     * par ce modèle plutôt que par un modèle séparé pour que la numérotation,
     * le PDF, la certification SECeF et l'écriture comptable soient les mêmes
     * chemins de code : deux implémentations parallèles finissent toujours par
     * diverger sur un arrondi ou un statut.
     *
     * Conséquence à ne jamais oublier : **toute somme de chiffre d'affaires
     * doit filtrer sur ce champ**, sinon un avoir gonfle le CA au lieu de le
     * réduire. Voir `salesScope()` dans lib/api-helpers.
     */
    documentType: { type: String, enum: ["invoice", "credit_note"], default: "invoice", index: true },

    /** Facture annulée ou corrigée. Obligatoire sur un avoir. */
    originalInvoiceId: { type: Schema.Types.ObjectId, ref: "Invoice" },
    /** Motif de l'avoir — exigé : un avoir sans motif est inopposable. */
    creditReason: String,

    /**
     * Montant TTC déjà couvert par des avoirs, sur une facture d'origine.
     * Dénormalisé pour que le contrôle « on ne peut pas avoir plus que la
     * facture » ne dépende pas d'une agrégation à chaque écriture.
     */
    creditedAmount: { type: Number, default: 0, min: 0 },

    number: { type: String, required: true },
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true },
    // Imputation analytique de la vente : recette du projet et du secteur.
    projectId: { type: Schema.Types.ObjectId, ref: "Project" },
    activityId: { type: Schema.Types.ObjectId, ref: "Activity" },
    quoteId: { type: Schema.Types.ObjectId, ref: "Devis" },
    lines: { type: [InvoiceLineSchema], required: true },
    totalHT: { type: Number, required: true },
    totalTVA: { type: Number, required: true },
    totalDTS: { type: Number, default: 0 },         // Droits de timbre Niger
    totalTTC: { type: Number, required: true },
    retenueSource: { type: Number, default: 0 },    // Retenue à la source marchés publics
    status: {
      type: String,
      enum: ["draft", "sent", "partial", "paid", "overdue", "cancelled"],
      default: "draft",
    },
    issueDate: { type: Date, required: true },
    // Un avoir n'a pas d'échéance de règlement : le champ n'est requis que
    // sur une facture.
    dueDate: {
      type: Date,
      required: function (this: { documentType?: string }) {
        return this.documentType !== "credit_note";
      },
    },
    paidAmount: { type: Number, default: 0 },

    /**
     * Litige ouvert par le client. Suspend les relances automatiques : relancer
     * une facture contestée transforme un désaccord sur une ligne en conflit
     * sur la relation.
     */
    disputedAt: Date,
    disputeReason: String,

    notes: String,
    termsAndConditions: String,
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },

    /**
     * Certification SECeF (Niger). Renseignée à l'émission par le MCF, ou
     * reportée depuis le portail e-SECeF. Une facture certifiée ne se modifie
     * plus : le code engage la responsabilité de l'assujetti et doit être
     * conservé dix ans.
     */
    secef: {
      code: String,
      qrPayload: String,
      certifiedAt: Date,
      counters: String,
      signature: String,
      mcfId: String,
      /** Pilote ayant produit la certification (« portal », « emcf »…). */
      driver: String,
      /** Type DGI : FV pour une vente, FA pour un avoir. */
      invoiceType: { type: String, enum: ["FV", "FA"] },
      /** Code de la facture d'origine, pour un avoir. */
      referencedCode: String,
    },
  },
  { timestamps: true }
);

InvoiceSchema.index({ tenantId: 1, number: 1 }, { unique: true });
InvoiceSchema.index({ tenantId: 1, status: 1 });
InvoiceSchema.index({ tenantId: 1, clientId: 1 });
InvoiceSchema.index({ tenantId: 1, dueDate: 1 });
InvoiceSchema.index({ tenantId: 1, documentType: 1, issueDate: -1 });
InvoiceSchema.index({ tenantId: 1, originalInvoiceId: 1 });
// Le code SECeF est unique par organisation : deux factures ne peuvent pas
// porter la même certification. `sparse` laisse coexister les non certifiées.
// Index PARTIEL, et non `sparse` : sur un champ imbriqué, sparse indexe aussi
// les documents dont `secef.code` vaut `null` (le cas des factures non
// certifiées, que Mongoose matérialise à null). Deux factures non certifiées
// entraient alors en collision d'unicité — et l'index ne pouvait même pas se
// construire en présence de plusieurs nulls. Le filtre partiel ne retient que
// les factures qui portent un vrai code SECeF.
InvoiceSchema.index(
  { tenantId: 1, "secef.code": 1 },
  { unique: true, partialFilterExpression: { "secef.code": { $type: "string" } } }
);

export const InvoiceModel = models.Invoice || model<IInvoice>("Invoice", InvoiceSchema);
