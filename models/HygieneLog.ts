import { Schema, model, models, Types } from "mongoose";

/**
 * Registre d'hygiène (HACCP) d'un restaurant, une ligne par enregistrement :
 *  - temperature : relevé d'une enceinte froide ou chaude, conforme ou non, action corrective ;
 *  - reception : contrôle à réception (température, emballages, dates), lignes acceptées ou refusées ;
 *  - sample : plat témoin prélevé, à garder jusqu'à une date, puis jeté ;
 *  - cleaning : tâche du plan de nettoyage faite.
 * Les lignes ne se modifient pas (registre) ; un plat témoin reçoit seulement sa date d'élimination.
 */
export type HygieneKind = "temperature" | "reception" | "sample" | "cleaning";
export interface IHygieneLog {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  deskId: Types.ObjectId;
  kind: HygieneKind;
  at: Date;
  day: string;
  unitId?: Types.ObjectId; unitName?: string; value?: number; min?: number; max?: number;
  ok?: boolean;
  action?: string;
  reference?: string; supplierName?: string; chain?: "ambient" | "chilled" | "frozen"; packagingOk?: boolean; datesOk?: boolean;
  lines?: Array<{ itemId: Types.ObjectId; name: string; quantity: number; refused: boolean; reason?: string }>;
  itemId?: Types.ObjectId; itemName?: string; service?: string; keepUntil?: Date; discardedAt?: Date; discardedBy?: Types.ObjectId;
  taskId?: Types.ObjectId; task?: string; zone?: string;
  note?: string;
  by: Types.ObjectId;
  createdAt: Date;
}

const HygieneLogSchema = new Schema<IHygieneLog>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
  deskId: { type: Schema.Types.ObjectId, ref: "ActivityDesk", required: true },
  kind: { type: String, enum: ["temperature", "reception", "sample", "cleaning"], required: true },
  at: { type: Date, required: true },
  day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  unitId: Schema.Types.ObjectId, unitName: { type: String, maxlength: 80 }, value: Number, min: Number, max: Number,
  ok: Boolean,
  action: { type: String, maxlength: 300 },
  reference: { type: String, maxlength: 60 }, supplierName: { type: String, maxlength: 120 }, chain: { type: String, enum: ["ambient", "chilled", "frozen"] }, packagingOk: Boolean, datesOk: Boolean,
  lines: { type: [{ _id: false, itemId: { type: Schema.Types.ObjectId, ref: "ActivityItem" }, name: String, quantity: Number, refused: Boolean, reason: { type: String, maxlength: 200 } }], default: undefined },
  itemId: { type: Schema.Types.ObjectId, ref: "ActivityItem" }, itemName: String, service: String, keepUntil: Date, discardedAt: Date, discardedBy: { type: Schema.Types.ObjectId, ref: "User" },
  taskId: Schema.Types.ObjectId, task: { type: String, maxlength: 120 }, zone: { type: String, maxlength: 80 },
  note: { type: String, maxlength: 300 },
  by: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

HygieneLogSchema.index({ tenantId: 1, deskId: 1, kind: 1, day: -1 });
HygieneLogSchema.index({ tenantId: 1, deskId: 1, kind: 1, discardedAt: 1, keepUntil: 1 });

export const HygieneLogModel = models.HygieneLog || model<IHygieneLog>("HygieneLog", HygieneLogSchema);
