import { Schema, model, models, Types } from "mongoose";

/**
 * Clôture mensuelle de gestion d'un comptoir : le résultat du mois figé à la
 * date de clôture (validé par la finance). Un mois clos est verrouillé :
 * ventes, caisse, pertes, mouvements et inventaires datés de ce mois (ou
 * d'avant) sont refusés. Une réouverture exige un motif ; chaque clôture
 * précédente reste dans l'historique.
 */
export interface IDeskMonthClose {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  deskId: Types.ObjectId;
  month: string;
  status: "closed" | "reopened";
  snapshot: Record<string, unknown>;
  note?: string;
  history: Array<{ snapshot: Record<string, unknown>; closedBy: Types.ObjectId; closedAt: Date; reopenedBy: Types.ObjectId; reopenedAt: Date; reason: string }>;
  closedBy: Types.ObjectId;
  closedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DeskMonthCloseSchema = new Schema<IDeskMonthClose>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
  deskId: { type: Schema.Types.ObjectId, ref: "ActivityDesk", required: true },
  month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
  status: { type: String, enum: ["closed", "reopened"], default: "closed" },
  snapshot: { type: Schema.Types.Mixed, required: true },
  note: { type: String, maxlength: 400 },
  history: [{ _id: false, snapshot: Schema.Types.Mixed, closedBy: Schema.Types.ObjectId, closedAt: Date, reopenedBy: Schema.Types.ObjectId, reopenedAt: Date, reason: String }],
  closedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  closedAt: { type: Date, required: true },
}, { timestamps: true });

DeskMonthCloseSchema.index({ tenantId: 1, deskId: 1, month: 1 }, { unique: true });

export const DeskMonthCloseModel = models.DeskMonthClose || model<IDeskMonthClose>("DeskMonthClose", DeskMonthCloseSchema);
