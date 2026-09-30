import { Schema, model, models } from "mongoose";

const CountLineSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    /** Article suivi par lot : une ligne par lot. */
    lotNumber: String,
    expiryDate: Date,
    /** Code et libellé recopiés : un produit renommé après l'inventaire ne doit
     *  pas réécrire ce qui a été compté ce jour-là. */
    code: { type: String, required: true },
    label: { type: String, required: true },
    unit: String,

    /**
     * Quantité au système, **figée à l'ouverture**. Sans cette photographie,
     * une vente saisie pendant le comptage transforme un stock juste en écart,
     * et un écart réel en stock juste.
     */
    theoreticalQty: { type: Number, required: true },

    /** `null` tant que la ligne n'a pas été relevée — différent de zéro. */
    countedQty: { type: Number, default: null },
    recountQty: { type: Number, default: null },

    /** Coût unitaire retenu, figé lui aussi. */
    unitCost: { type: Number, default: null },

    reason: String,
    countedBy: { type: Schema.Types.ObjectId, ref: "User" },
    countedAt: Date,
    recountedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { _id: true }
);

const InventoryCountSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    reference: { type: String, required: true },
    label: { type: String, required: true, trim: true },

    status: {
      type: String,
      enum: ["draft", "counting", "review", "validated", "cancelled"],
      default: "draft",
      index: true,
    },

    /** Périmètre : tout le stock, ou une sélection. */
    scope: { type: String, enum: ["all", "selection"], default: "all" },
    /** Entrepôt inventorié (défaut : entrepôt principal). */
    warehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse" },
    location: String,

    /**
     * Comptage aveugle : la quantité théorique n'est pas montrée au compteur.
     * Devant « théorique 48 », on compte 48 — l'écart réel disparaît, et avec
     * lui la seule raison de faire l'inventaire.
     */
    blind: { type: Boolean, default: true },

    recountThresholdQty: { type: Number, default: 10 },
    recountThresholdPercent: { type: Number, default: 10 },
    reasonThresholdValue: { type: Number, default: 50000 },

    lines: { type: [CountLineSchema], default: [] },

    openedAt: Date,
    openedBy: { type: Schema.Types.ObjectId, ref: "User" },
    validatedAt: Date,
    validatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    cancelledAt: Date,

    /** Totaux figés à la validation : ils doivent correspondre à l'écriture. */
    shortageValue: Number,
    surplusValue: Number,
    accuracy: Number,

    notes: String,
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

InventoryCountSchema.index({ tenantId: 1, reference: 1 }, { unique: true });
InventoryCountSchema.index({ tenantId: 1, status: 1, createdAt: -1 });

export const InventoryCountModel =
  models.InventoryCount || model("InventoryCount", InventoryCountSchema);
