import { Schema, model, models, Types } from "mongoose";

/**
 * Bilan du jour clos envoyé par EasyPay (contrat v1, `day.closed`) : chiffres
 * des rapports du back-office d'EasyPay pour un restaurant et un jour. Un
 * bilan par comptoir et par jour, celui de plus grande révision.
 */
export interface IEasypayDayClose {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  deskId: Types.ObjectId;
  businessDate: string;
  revision: number;
  eventId: string;
  data: Record<string, unknown>;
  receivedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const EasypayDayCloseSchema = new Schema<IEasypayDayClose>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
  deskId: { type: Schema.Types.ObjectId, ref: "ActivityDesk", required: true },
  businessDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  revision: { type: Number, required: true, min: 1 },
  eventId: { type: String, required: true, maxlength: 64 },
  data: { type: Schema.Types.Mixed, required: true },
  receivedAt: { type: Date, required: true },
}, { timestamps: true });

EasypayDayCloseSchema.index({ tenantId: 1, deskId: 1, businessDate: 1 }, { unique: true });

export const EasypayDayCloseModel = models.EasypayDayClose || model<IEasypayDayClose>("EasypayDayClose", EasypayDayCloseSchema);
