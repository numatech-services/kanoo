import { Schema, model, models } from "mongoose";

/**
 * Une pièce jointe rattachée à un document métier.
 *
 * `host` désigne la ressource RBAC qui commande l'accès : lire la pièce jointe
 * d'un contrat exige le droit de lire les contrats. Sans ce champ, il faudrait
 * réimplémenter l'autorisation dans la route de téléchargement — et se tromper
 * une fois suffirait à ouvrir tous les documents de toutes les organisations.
 */
const AttachmentSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },

    /** Ressource RBAC du document porteur : "contracts", "invoices", "expenses"… */
    host: { type: String, required: true },
    /** Identifiant du document porteur. */
    hostId: { type: Schema.Types.ObjectId, required: true },

    filename: { type: String, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    /** Empreinte du contenu : sert à la déduplication et au contrôle d'intégrité. */
    sha256: { type: String, required: true, index: true },
    /** Chemin relatif dans le stockage. Jamais exposé au client. */
    storageKey: { type: String, required: true },

    /**
     * Nature de la pièce, choisie par l'utilisateur.
     * Un contrat signé et son avenant ne se cherchent pas de la même façon.
     */
    category: {
      type: String,
      enum: ["contrat", "avenant", "facture", "justificatif", "releve", "courrier", "autre"],
      default: "autre",
    },
    label: String,

    /**
     * Ligne du document porteur, quand il en a plusieurs.
     *
     * Une note de frais porte un justificatif *par dépense* : sans ce champ, le
     * contrôle « pas de remboursement sans pièce » ne saurait pas laquelle des
     * douze lignes est couverte.
     */
    lineId: Schema.Types.ObjectId,

    uploadedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

AttachmentSchema.index({ tenantId: 1, host: 1, hostId: 1, createdAt: -1 });

export const AttachmentModel = models.Attachment || model("Attachment", AttachmentSchema);
