import { Schema, model, models } from "mongoose";
// « isbic » : déclaration annuelle IS/BIC (app/api/fiscal/isbic). Absent de la
// liste, son enregistrement échouait toujours à la validation.
const FiscalDeclarationSchema = new Schema({ tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true }, type: { type: String, enum: ["tva","cnss","bic","is","isbic","dts","retenue","acompte"], required: true }, period: { mois: Number, trimestre: Number, annee: { type: Number, required: true } }, amounts: { base: Number, taux: Number, montant: Number, deductible: Number, net: Number }, status: { type: String, enum: ["draft","submitted","paid","late"], default: "draft" }, submittedAt: Date, paidAt: Date, reference: String, notes: String, /** Incrémenté à chaque liquidation de TVA : deux liquidations simultanées entrent en conflit. */ settlementVersion: { type: Number, default: 0 }, createdBy: { type: Schema.Types.ObjectId, ref: "User" } }, { timestamps: true });
FiscalDeclarationSchema.index({ tenantId: 1, type: 1, "period.annee": 1 });
// Une seule déclaration IS/BIC par exercice (deux envois simultanés en créaient deux).
FiscalDeclarationSchema.index({ tenantId: 1, "period.annee": 1, type: 1 }, { unique: true, partialFilterExpression: { type: "isbic" }, name: "unique_isbic_per_year" });
export const FiscalDeclarationModel = models.FiscalDeclaration || model("FiscalDeclaration", FiscalDeclarationSchema);
