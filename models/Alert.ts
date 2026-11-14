import { Schema, model, models, type Types } from "mongoose";

/**
 * Alerte saisie à la main : une échéance à ne pas manquer, avec ce qu'il en
 * coûte de la manquer (« enregistrer le contrat dans le mois, sinon
 * pénalités »). Rappels par notification aux délais choisis, puis chaque
 * semaine de retard, jusqu'à ce qu'elle soit marquée traitée.
 *
 * Destinataires : les personnes choisies, sinon la direction et la
 * comptabilité (lib/alerts-server.ts, DEFAULT_RECIPIENT_ROLES).
 */
export interface AlertDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  title: string;
  description?: string;
  /** Conséquence d'un oubli : pénalité, suspension, perte d'un droit. */
  consequence?: string;
  category: string;
  dueDate: Date;
  remindDays: number[];
  repeat: string;
  /** Quantième d'origine d'une alerte récurrente (31 → 28 févr. → 31 mars). */
  anchorDay?: number;
  assigneeIds: Types.ObjectId[];
  contractId?: Types.ObjectId;
  status: "open" | "done" | "cancelled";
  doneAt?: Date;
  doneBy?: Types.ObjectId;
  doneNote?: string;
  /** Occurrence précédente d'une alerte récurrente. */
  previousId?: Types.ObjectId;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AlertSchema = new Schema<AlertDoc>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, maxlength: 2000 },
    consequence: { type: String, maxlength: 500 },
    category: { type: String, enum: ["contrat", "fiscal", "social", "administratif", "banque", "autre"], default: "autre" },
    dueDate: { type: Date, required: true },
    remindDays: { type: [Number], default: [7, 1] },
    repeat: { type: String, enum: ["none", "monthly", "quarterly", "yearly"], default: "none" },
    anchorDay: { type: Number, min: 1, max: 31 },
    assigneeIds: { type: [Schema.Types.ObjectId], ref: "User", default: [] },
    contractId: { type: Schema.Types.ObjectId, ref: "Contract" },
    status: { type: String, enum: ["open", "done", "cancelled"], default: "open" },
    doneAt: Date,
    doneBy: { type: Schema.Types.ObjectId, ref: "User" },
    doneNote: { type: String, maxlength: 1000 },
    previousId: { type: Schema.Types.ObjectId, ref: "Alert" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

AlertSchema.index({ tenantId: 1, status: 1, dueDate: 1 });
AlertSchema.index({ tenantId: 1, contractId: 1 });
// Une seule occurrence suivante par alerte récurrente (traitée, rouverte, retraitée).
AlertSchema.index({ previousId: 1 }, { unique: true, partialFilterExpression: { previousId: { $exists: true } } });
// Tâche quotidienne : toutes les alertes ouvertes, toutes organisations.
AlertSchema.index({ status: 1, dueDate: 1 });

export const AlertModel = models.Alert || model<AlertDoc>("Alert", AlertSchema);
