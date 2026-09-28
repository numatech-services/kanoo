import { Schema, model, models, Types } from "mongoose";

/**
 * Lot de production de cartes ISIC pour une université.
 *
 * Cycle : reçu (fichiers étudiants) → traitement → envoyé à ISIC → numéros
 * reçus → impression → imprimées → livraison (au fur et à mesure) → terminé.
 * Le module suit aussi le financier : coût des licences ISIC (achat) vs revente
 * à l'université (marge), et les encaissements.
 */
export type IsicStatus =
  | "received" | "processing" | "submitted" | "numbered"
  | "printing" | "printed" | "delivering" | "completed" | "cancelled";

export interface IIsicDelivery { _id?: Types.ObjectId; date: Date; quantity: number; note?: string }
export interface IIsicPayment { _id?: Types.ObjectId; date: Date; amount: number; method?: string; note?: string }

export interface IIsicBatch {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  reference: string;
  /** Université cliente : lien vers un client, plus un nom en clair de secours. */
  universityId?: Types.ObjectId;
  universityName: string;
  academicYear?: string;
  status: IsicStatus;
  totalCards: number;
  /** Coût d'une licence ISIC (achat) et prix de revente d'une carte (à l'université). */
  unitLicenseFee: number;
  unitSalePrice: number;
  /** Fichiers : reçu de l'université, et retourné par ISIC (avec numéros). Data-URI. */
  receivedFile?: { name?: string; dataUri?: string };
  isicFile?: { name?: string; dataUri?: string };
  submittedAt?: Date;
  numberedAt?: Date;
  /** Livraisons partielles (au fur et à mesure) et encaissements. */
  deliveries: IIsicDelivery[];
  payments: IIsicPayment[];
  /** Règlements des frais de licence versés à ISIC (le coût, côté achat). */
  licensePayments: IIsicPayment[];
  /** Facture de revente générée pour l'université. */
  invoiceId?: Types.ObjectId;
  notes?: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const DeliverySchema = new Schema<IIsicDelivery>({
  date: { type: Date, required: true, default: Date.now },
  quantity: { type: Number, required: true, min: 1 },
  note: String,
}, { _id: true });

const PaymentSchema = new Schema<IIsicPayment>({
  date: { type: Date, required: true, default: Date.now },
  amount: { type: Number, required: true, min: 0 },
  method: String,
  note: String,
}, { _id: true });

const IsicBatchSchema = new Schema<IIsicBatch>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  reference: { type: String, required: true },
  universityId: { type: Schema.Types.ObjectId, ref: "Client" },
  universityName: { type: String, required: true, trim: true },
  academicYear: String,
  status: {
    type: String,
    enum: ["received", "processing", "submitted", "numbered", "printing", "printed", "delivering", "completed", "cancelled"],
    default: "received", index: true,
  },
  totalCards: { type: Number, required: true, min: 0, default: 0 },
  unitLicenseFee: { type: Number, min: 0, default: 0 },
  unitSalePrice: { type: Number, min: 0, default: 0 },
  receivedFile: { name: String, dataUri: String },
  isicFile: { name: String, dataUri: String },
  submittedAt: Date,
  numberedAt: Date,
  deliveries: { type: [DeliverySchema], default: [] },
  payments: { type: [PaymentSchema], default: [] },
  licensePayments: { type: [PaymentSchema], default: [] },
  invoiceId: { type: Schema.Types.ObjectId, ref: "Invoice" },
  notes: String,
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

IsicBatchSchema.index({ tenantId: 1, status: 1 });
IsicBatchSchema.index({ tenantId: 1, createdAt: -1 });

export const IsicBatchModel = models.IsicBatch || model<IIsicBatch>("IsicBatch", IsicBatchSchema);
