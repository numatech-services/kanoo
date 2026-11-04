import { Schema, model, models, Types } from "mongoose";

/**
 * Situation de départ d'un site, ligne par ligne.
 *  - money : argent remis à la caisse du site (écriture et mouvement de
 *    trésorerie faits) : virement d'un compte de l'entreprise, avance à
 *    rembourser, apport, ou origine à classer ;
 *  - owner_paid : payé directement par le dirigeant pour le site (stock,
 *    équipement) : aucun mouvement de caisse ;
 *  - debt / receivable : dette fournisseur ou créance de départ ;
 *  - equipment : équipement déjà financé.
 * Seules les lignes `money` passent en comptabilité d'office. Les autres
 * restent « à passer par la comptable » (`validatedAt` vide) ; elles alimentent
 * le tableau ressources / emplois sans toucher au résultat.
 */
export interface IDeskFunding {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  deskId: Types.ObjectId;
  kind: "money" | "owner_paid" | "debt" | "receivable" | "equipment";
  nature?: "transfer" | "advance" | "contribution" | "to_classify";
  amount: number;
  date: Date;
  label: string;
  /** Avance à rembourser : le remboursé s'accumule dans `repayments`. */
  repayable: boolean;
  repaid: number;
  repayments: Array<{ date: Date; amount: number; fromAccountId: Types.ObjectId; entryId?: Types.ObjectId; movementId?: Types.ObjectId; by: Types.ObjectId }>;
  fromAccountId?: Types.ObjectId;
  /** Compte de contrepartie (origine des fonds). */
  accountCode?: string;
  entryId?: Types.ObjectId;
  movementIds: Types.ObjectId[];
  cashEntryId?: Types.ObjectId;
  validatedBy?: Types.ObjectId;
  validatedAt?: Date;
  cancelledAt?: Date;
  cancelledBy?: Types.ObjectId;
  cancelReason?: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
}

const DeskFundingSchema = new Schema<IDeskFunding>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
  deskId: { type: Schema.Types.ObjectId, ref: "ActivityDesk", required: true },
  kind: { type: String, enum: ["money", "owner_paid", "debt", "receivable", "equipment"], required: true },
  nature: { type: String, enum: ["transfer", "advance", "contribution", "to_classify"] },
  amount: { type: Number, required: true, min: 1 },
  date: { type: Date, required: true },
  label: { type: String, required: true, trim: true, maxlength: 200 },
  repayable: { type: Boolean, default: false },
  repaid: { type: Number, default: 0, min: 0 },
  repayments: [{ _id: false, date: Date, amount: Number, fromAccountId: Schema.Types.ObjectId, entryId: Schema.Types.ObjectId, movementId: Schema.Types.ObjectId, by: Schema.Types.ObjectId }],
  fromAccountId: { type: Schema.Types.ObjectId, ref: "TreasuryAccount" },
  accountCode: { type: String, maxlength: 12 },
  entryId: { type: Schema.Types.ObjectId, ref: "AccountingEntry" },
  movementIds: [{ type: Schema.Types.ObjectId, ref: "TreasuryMovement" }],
  cashEntryId: { type: Schema.Types.ObjectId, ref: "ActivityCashEntry" },
  validatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  validatedAt: Date,
  cancelledAt: Date,
  cancelledBy: { type: Schema.Types.ObjectId, ref: "User" },
  cancelReason: { type: String, maxlength: 300 },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

DeskFundingSchema.index({ tenantId: 1, deskId: 1, date: -1 });

export const DeskFundingModel = models.DeskFunding || model<IDeskFunding>("DeskFunding", DeskFundingSchema);
