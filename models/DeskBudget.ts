import { Schema, model, models, Types } from "mongoose";

/**
 * Budget annuel d'un restaurant : chiffre d'affaires HT mois par mois (la
 * saisonnalité d'un restaurant de campus est forte), coût matière visé en
 * pourcentage du CA, charges annuelles par rubrique (réparties en douzièmes).
 * Comparé chaque mois au résultat réel.
 */
export interface IDeskBudget {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  deskId: Types.ObjectId;
  year: number;
  revenue: number[];
  materialPct: number;
  charges: Array<{ category: string; annual: number }>;
  note?: string;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const DeskBudgetSchema = new Schema<IDeskBudget>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
  deskId: { type: Schema.Types.ObjectId, ref: "ActivityDesk", required: true },
  year: { type: Number, required: true, min: 2000, max: 2100 },
  revenue: { type: [Number], validate: (v: number[]) => v.length === 12 && v.every(n => n >= 0), required: true },
  materialPct: { type: Number, required: true, min: 0, max: 1 },
  charges: [{ _id: false, category: { type: String, required: true, maxlength: 30 }, annual: { type: Number, required: true, min: 0 } }],
  note: { type: String, maxlength: 300 },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

DeskBudgetSchema.index({ tenantId: 1, deskId: 1, year: 1 }, { unique: true });

export const DeskBudgetModel = models.DeskBudget || model<IDeskBudget>("DeskBudget", DeskBudgetSchema);
