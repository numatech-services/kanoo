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
  staff?: Array<{ employeeId: Types.ObjectId; share: number; from?: string; to?: string }>;
  /** Charges prévues par mois (budget), comparées au réel et utilisées pour le point mort. */
  plannedCosts?: Array<{ category: string; label?: string; amount: number }>;
  /** Jours d'ouverture par mois (point mort par jour). */
  openDaysPerMonth?: number;
  /** Quote-part des charges communes non imputées (loyer global, compteur commun…) portée par ce comptoir (0,25 = 25 %). */
  commonCostShare?: number;
  /** Part des charges du secteur analytique portée par ce comptoir quand le secteur est partagé (clé d'activité : surface, couverts, temps…). Absente = parts égales. */
  sectorShare?: number;
  /** Rubriques de charges qui suivent le volume vendu (simulation d'une baisse d'activité). Absente = liste par défaut. */
  variableCategories?: string[];
  /** HACCP : enceintes à relever (réfrigérateur, congélateur, maintien au chaud) et leurs limites en °C. */
  coldUnits?: Array<{ _id: Types.ObjectId; name: string; kind: "fridge" | "freezer" | "hot"; min?: number; max?: number }>;
  /** HACCP : plan de nettoyage (zone, tâche, fréquence). */
  cleaningTasks?: Array<{ _id: Types.ObjectId; zone: string; task: string; frequency: "service" | "daily" | "weekly" | "monthly" }>;
  /** Livraisons permanentes (pain du jour…) : quantité attendue par jour de la semaine (0 = dimanche), prix, frais de livraison, payées chaque soir. */
  standingDeliveries?: Array<{ _id: Types.ObjectId; itemId: Types.ObjectId; supplierId?: Types.ObjectId; supplierName?: string; unitCost: number; quantities: number[]; dailyFee?: number; toDesk: boolean; active: boolean }>;
  /** Bouteilles de gaz mises en service (date), pour la durée d'une bouteille et le coût du gaz par jour. */
  gasBottles?: Array<{ startedAt: Date; by: Types.ObjectId }>;
  /** Vente d'un plat permise même si un ingrédient manque au comptoir : l'écart se régularise à l'inventaire. */
  lenientStock?: boolean;
  /** Marge nette visée, tous frais compris (personnel, eau, électricité…) : 0,20 = 20 % du CA HT. */
  targetNetMargin?: number;
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
  // Affectation datée (AAAA-MM-JJ, bornes incluses ; absentes = sans limite) : un mois passé ne change pas quand l'équipe bouge.
  staff: [{ _id: false, employeeId: { type: Schema.Types.ObjectId, ref: "Employee", required: true }, share: { type: Number, required: true, min: 0, max: 1 }, from: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ }, to: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ } }],
  plannedCosts: [{ _id: false, category: { type: String, required: true, maxlength: 30 }, label: { type: String, maxlength: 80 }, amount: { type: Number, required: true, min: 0 } }],
  openDaysPerMonth: { type: Number, default: 26, min: 1, max: 31 },
  commonCostShare: { type: Number, min: 0, max: 1 },
  sectorShare: { type: Number, min: 0, max: 1 },
  variableCategories: { type: [String], default: undefined },
  coldUnits: [{ name: { type: String, required: true, maxlength: 80 }, kind: { type: String, enum: ["fridge", "freezer", "hot"], required: true }, min: Number, max: Number }],
  standingDeliveries: [{ itemId: { type: Schema.Types.ObjectId, ref: "ActivityItem", required: true }, supplierId: { type: Schema.Types.ObjectId, ref: "Supplier" }, supplierName: { type: String, maxlength: 120 },
    unitCost: { type: Number, required: true, min: 0 }, quantities: { type: [Number], validate: (v: number[]) => v.length === 7 && v.every(n => n >= 0) }, dailyFee: { type: Number, min: 0 }, toDesk: { type: Boolean, default: true }, active: { type: Boolean, default: true } }],
  gasBottles: [{ _id: false, startedAt: { type: Date, required: true }, by: { type: Schema.Types.ObjectId, ref: "User" } }],
  cleaningTasks: [{ zone: { type: String, required: true, maxlength: 80 }, task: { type: String, required: true, maxlength: 120 }, frequency: { type: String, enum: ["service", "daily", "weekly", "monthly"], required: true } }],
  lenientStock: { type: Boolean, default: false },
  targetNetMargin: { type: Number, default: 0.2, min: 0, max: 0.9 },
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
