import { Schema, model, models } from "mongoose";

export type DepreciationMethod = "linear" | "degressive" | "none";

export type AssetCategory =
  | "building"          // Immeubles
  | "equipment"         // Matériels et outillages
  | "vehicle"           // Véhicules
  | "furniture"         // Mobilier de bureau
  | "computer"          // Matériel informatique
  | "software"          // Logiciels
  | "land"              // Terrains (non amortissable)
  | "other";

const DepreciationEntrySchema = new Schema({
  year:           { type: Number, required: true },
  annuity:        { type: Number, required: true },    // Dotation annuelle
  cumulative:     { type: Number, required: true },    // Cumul amortissements
  netValue:       { type: Number, required: true },    // Valeur nette comptable
  accountingEntryId: { type: Schema.Types.ObjectId, ref: "AccountingEntry" },
  posted:         { type: Boolean, default: false },   // Écriture passée en comptabilité
  postedAt:       Date,
}, { _id: true });

const FixedAssetSchema = new Schema({
  tenantId:     { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  code:         { type: String, required: true },
  name:         { type: String, required: true },
  description:  String,
  category:     {
    type: String,
    enum: ["building","equipment","vehicle","furniture","computer","software","land","other"],
    required: true,
  },

  // Valeurs financières
  acquisitionDate:  { type: Date, required: true },
  acquisitionCost:  { type: Number, required: true },   // Valeur d'acquisition (XOF)
  residualValue:    { type: Number, default: 0 },        // Valeur résiduelle
  currentNetValue:  { type: Number },                   // VNC courante (calculée)

  // Amortissement
  depreciationMethod: { type: String, enum: ["linear","degressive","none"], default: "linear" },
  usefulLifeYears:    { type: Number, default: 5 },
  degressiveRate:     Number,                            // Taux dégressif (si méthode dégressive)

  // Comptes OHADA
  accountCode:        { type: String, default: "24" },  // Compte immo
  depreciationAccount:{ type: String, default: "28" },  // Compte amortissement
  dotationAccount:    { type: String, default: "68" },  // Compte dotation

  // Plan d'amortissement calculé
  depreciationSchedule: [DepreciationEntrySchema],

  // Cession / mise au rebut
  disposalDate:   Date,
  disposalValue:  Number,
  disposalReason: { type: String, enum: ["sale","scrap","transfer","other"] },

  status: {
    type: String,
    enum: ["active","disposed","fully_depreciated"],
    default: "active",
  },

  supplier:       String,
  invoiceRef:     String,
  location:       String,
  serialNumber:   String,
  notes:          String,
  createdBy:      { type: Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });

FixedAssetSchema.index({ tenantId: 1, code: 1 }, { unique: true });
FixedAssetSchema.index({ tenantId: 1, category: 1 });
FixedAssetSchema.index({ tenantId: 1, status: 1 });

export const FixedAssetModel = models.FixedAsset || model("FixedAsset", FixedAssetSchema);
