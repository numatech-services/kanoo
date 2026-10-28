import { Schema, model, models } from "mongoose";

/**
 * Client à l'ardoise d'un comptoir : un habitué qui consomme à crédit,
 * jusqu'à un plafond, et règle plus tard. Le solde dû est tenu par les
 * mouvements (DeskCustomerMove) et recopié ici, mis à jour atomiquement.
 */
const DeskCustomerSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  deskId: { type: Schema.Types.ObjectId, ref: "ActivityDesk", required: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  phone: { type: String, trim: true, maxlength: 30 },
  /** Plafond de l'ardoise (0 = pas de crédit). */
  creditLimit: { type: Number, default: 0, min: 0 },
  /** Dû à ce jour. */
  balance: { type: Number, default: 0 },
  /** Date de la plus ancienne dette non soldée (relances). */
  oldestDebtAt: Date,
  notes: { type: String, maxlength: 300 },
  active: { type: Boolean, default: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

DeskCustomerSchema.index({ tenantId: 1, deskId: 1, name: 1 });

export const DeskCustomerModel = models.DeskCustomer || model("DeskCustomer", DeskCustomerSchema);

/** Mouvement d'ardoise : vente à crédit (+), règlement ou annulation (−). */
const DeskCustomerMoveSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  deskId: { type: Schema.Types.ObjectId, ref: "ActivityDesk", required: true },
  customerId: { type: Schema.Types.ObjectId, ref: "DeskCustomer", required: true, index: true },
  kind: { type: String, enum: ["sale", "payment", "cancel"], required: true },
  /** Signé : + la dette augmente, − elle diminue. */
  amount: { type: Number, required: true },
  saleId: { type: Schema.Types.ObjectId, ref: "ComptoirSale" },
  cashEntryId: { type: Schema.Types.ObjectId, ref: "ActivityCashEntry" },
  method: String,
  date: { type: Date, required: true },
  label: { type: String, maxlength: 160 },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

export const DeskCustomerMoveModel = models.DeskCustomerMove || model("DeskCustomerMove", DeskCustomerMoveSchema);
