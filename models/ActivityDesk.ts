import { Schema, model, models, Types } from "mongoose";

/**
 * Comptoir / point d'activité (« The Spot » et tout autre point à venir).
 *
 * Une activité que l'on gère à part, avec sa propre **comptabilité matière**
 * (stock d'articles) et sa propre **caisse** (argent). Sa gestion peut être
 * confiée à un rôle dédié (« Gestionnaire d'activité ») en plus du comptable
 * principal, sans lui ouvrir toute la comptabilité de l'organisation.
 *
 * Rattaché facultativement à un secteur analytique (`activityId`) pour que ses
 * résultats remontent dans la rentabilité par secteur.
 */
export interface IActivityDesk {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  name: string;
  description?: string;
  /** Secteur analytique lié (rentabilité par secteur), s'il y a lieu. */
  activityId?: Types.ObjectId;
  warehouseId?: Types.ObjectId;
  /** Réserve du restaurant (stock en gros : cartons, sacs, bidons), entrepôt de la gestion de stock. */
  reserveWarehouseId?: Types.ObjectId;
  /** Personnel affecté au comptoir et part de son temps (0,5 = mi-temps) : son coût entre dans le résultat. */
  staff?: Array<{ employeeId: Types.ObjectId; share: number }>;
  /** Charges prévues par mois (budget), comparées au réel et utilisées pour le point mort. */
  plannedCosts?: Array<{ category: string; label?: string; amount: number }>;
  /** Jours d'ouverture par mois (point mort par jour). */
  openDaysPerMonth?: number;
  /** Quote-part des charges communes non imputées (loyer global, compteur commun…) portée par ce comptoir (0,25 = 25 %). */
  commonCostShare?: number;
  /** Vente d'un plat permise même si un ingrédient manque au comptoir : l'écart se régularise à l'inventaire. */
  lenientStock?: boolean;
  /** Caisse de trésorerie qui reçoit les ventes ; sans elle, la caisse reste hors comptabilité. */
  treasuryAccountId?: Types.ObjectId;
  /** Produit des ventes (701100 marchandises, 706300 restauration…). */
  revenueAccount?: string;
  /** Charge des dépenses de caisse (601100 achats de marchandises…). */
  expenseAccount?: string;
  /** TVA comprise dans les prix (0 = non assujetti). */
  vatRate?: number;
  targetMarkup?: number;
  leadDays?: number; coverDays?: number; weeklyRevenueTarget?: number; weeklyMarginTarget?: number; cycleCountSize?: number;
  archived: boolean;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ActivityDeskSchema = new Schema<IActivityDesk>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, maxlength: 400 },
  activityId: { type: Schema.Types.ObjectId, ref: "Activity" },
  /** Réserve du comptoir dans la gestion de stock (créée automatiquement). */
  warehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse" },
  reserveWarehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse" },
  staff: [{ _id: false, employeeId: { type: Schema.Types.ObjectId, ref: "Employee", required: true }, share: { type: Number, required: true, min: 0, max: 1 } }],
  plannedCosts: [{ _id: false, category: { type: String, required: true, maxlength: 30 }, label: { type: String, maxlength: 80 }, amount: { type: Number, required: true, min: 0 } }],
  openDaysPerMonth: { type: Number, default: 26, min: 1, max: 31 },
  commonCostShare: { type: Number, min: 0, max: 1 },
  lenientStock: { type: Boolean, default: false },
  treasuryAccountId: { type: Schema.Types.ObjectId, ref: "TreasuryAccount" },
  revenueAccount: { type: String, default: "701100", match: /^7\d{2,7}$/ },
  expenseAccount: { type: String, default: "601100", match: /^6\d{2,7}$/ },
  vatRate: { type: Number, default: 0, min: 0, max: 0.5 },
  /** Taux de marque visé (part du prix HT), pour le prix conseillé et les alertes. */
  targetMarkup: { type: Number, default: 0.3, min: 0, max: 0.95 },
  /** Réassort : délai de livraison et jours à couvrir par une commande. */
  leadDays: { type: Number, default: 2, min: 0, max: 60 },
  coverDays: { type: Number, default: 7, min: 1, max: 90 },
  /** Objectifs de la semaine (proposés à l'ouverture de la caisse). */
  weeklyRevenueTarget: { type: Number, min: 0 },
  weeklyMarginTarget: { type: Number, min: 0 },
  /** Inventaire tournant : articles à compter par jour. */
  cycleCountSize: { type: Number, default: 5, min: 1, max: 50 },
  archived: { type: Boolean, default: false, index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

ActivityDeskSchema.index({ tenantId: 1, name: 1 }, { unique: true });

export const ActivityDeskModel = models.ActivityDesk || model<IActivityDesk>("ActivityDesk", ActivityDeskSchema);
