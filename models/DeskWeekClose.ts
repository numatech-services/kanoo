import { Schema, model, models, Types } from "mongoose";

/**
 * Clôture de semaine d'un site : la période jusqu'à `weekEnd` (AAAA-MM-JJ)
 * est arrêtée après l'inventaire. Ventes, mouvements et dépenses datés de cette
 * période sont alors refusés ; une réouverture exige un motif et reste tracée.
 * La semaine suivante repart du stock restant : rien n'est remis à zéro.
 */
export interface IDeskWeekClose {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  deskId: Types.ObjectId;
  weekEnd: string;
  status: "closed" | "reopened";
  summary: { stockValue: number; gapValue: number; inventories: number };
  note?: string;
  closedBy: Types.ObjectId;
  closedAt: Date;
  history: Array<{ closedBy: Types.ObjectId; closedAt: Date; reopenedBy: Types.ObjectId; reopenedAt: Date; reason: string }>;
}

const DeskWeekCloseSchema = new Schema<IDeskWeekClose>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
  deskId: { type: Schema.Types.ObjectId, ref: "ActivityDesk", required: true },
  weekEnd: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  status: { type: String, enum: ["closed", "reopened"], default: "closed" },
  summary: { stockValue: Number, gapValue: Number, inventories: Number },
  note: { type: String, maxlength: 400 },
  closedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  closedAt: { type: Date, required: true },
  history: [{ _id: false, closedBy: Schema.Types.ObjectId, closedAt: Date, reopenedBy: Schema.Types.ObjectId, reopenedAt: Date, reason: String }],
}, { timestamps: true });

DeskWeekCloseSchema.index({ tenantId: 1, deskId: 1, weekEnd: 1 }, { unique: true });
DeskWeekCloseSchema.index({ tenantId: 1, deskId: 1, status: 1, weekEnd: -1 });

export const DeskWeekCloseModel = models.DeskWeekClose || model<IDeskWeekClose>("DeskWeekClose", DeskWeekCloseSchema);
