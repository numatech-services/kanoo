import type { ClientSession } from "mongoose";
import { ProductModel } from "@/models/Product";
import { StockMovementModel } from "@/models/StockMovement";

export const MOVEMENT_TYPES = ["entry", "exit", "adjustment", "return", "loss"] as const;
export type MovementType = typeof MOVEMENT_TYPES[number];
export const MOVEMENT_LABEL: Record<MovementType, string> = {
  entry: "Entrée", exit: "Sortie", adjustment: "Ajustement d'inventaire", return: "Retour", loss: "Perte / casse",
};

export class StockError extends Error {}

export interface MovementInput {
  tenantId: string;
  userId: string;
  productId: unknown;
  type: MovementType;
  /**
   * Quantité positive. Pour `adjustment`, c'est le stock réel constaté (le
   * mouvement enregistré est l'écart).
   */
  quantity: number;
  /** Coût unitaire d'achat, pour une entrée valorisée (met à jour le CMUP). */
  unitCost?: number;
  reason: string;
  linkedDocType?: string;
  linkedDocId?: unknown;
  linkedDocNumber?: string;
  /** Sortie au-delà du stock : refusée (défaut) ou plafonnée au stock disponible. */
  allowPartial?: boolean;
}

/**
 * Seul point d'écriture du stock.
 *
 * - Mise à jour atomique ($inc sous condition) : deux saisies simultanées ne
 *   s'écrasent plus, et une sortie ne passe pas sous zéro.
 * - CMUP : une entrée valorisée recalcule le coût moyen
 *   (stock × CMUP + quantité × coût) / (stock + quantité).
 * - Chaque mouvement garde avant / après, coût et CMUP résultant.
 */
export async function applyMovement(input: MovementInput, session?: ClientSession) {
  if (!MOVEMENT_TYPES.includes(input.type)) throw new StockError("Type de mouvement inconnu.");
  const q = Number(input.quantity);
  if (!Number.isFinite(q) || q < 0 || (input.type !== "adjustment" && q === 0)) throw new StockError("Quantité invalide.");
  const reason = String(input.reason ?? "").trim();
  if (!reason) throw new StockError("Motif du mouvement obligatoire.");

  const product = await ProductModel.findOne({ _id: input.productId, tenantId: input.tenantId })
    .session(session ?? null).lean<{ _id: unknown; stockQty?: number; purchaseCost?: number; isService?: boolean; label: string } | null>();
  if (!product) throw new StockError("Produit introuvable.");
  if (product.isService) throw new StockError(`« ${product.label} » est un service : il n'a pas de stock.`);

  const before = product.stockQty ?? 0;
  let delta: number;
  if (input.type === "adjustment") delta = q - before;
  else if (input.type === "entry" || input.type === "return") delta = q;
  else delta = -q;

  if (delta < 0 && before + delta < 0) {
    if (!input.allowPartial) throw new StockError(`Stock insuffisant pour « ${product.label} » : ${before} disponible(s), ${-delta} demandé(s).`);
    delta = -before;
  }

  // CMUP : seules les entrées valorisées le modifient.
  const oldCost = product.purchaseCost ?? 0;
  const unitCost = Number(input.unitCost) > 0 ? Number(input.unitCost) : 0;
  let newCost = oldCost;
  if (input.type === "entry" && unitCost > 0 && delta > 0) {
    const base = Math.max(before, 0);
    newCost = Math.round(((base * oldCost + delta * unitCost) / (base + delta)) * 100) / 100;
  }

  const set: Record<string, unknown> = {};
  if (newCost !== oldCost) set.purchaseCost = newCost;
  if (input.type === "entry" && unitCost > 0) set.lastPurchaseCost = unitCost;
  // Garde-fou atomique : le stock n'a pas bougé depuis la lecture.
  const updated = await ProductModel.findOneAndUpdate(
    { _id: product._id, tenantId: input.tenantId, stockQty: product.stockQty ?? { $in: [null, 0] } },
    { $inc: { stockQty: delta }, ...(Object.keys(set).length ? { $set: set } : {}) },
    { new: true, session },
  ).lean<{ stockQty: number } | null>();
  if (!updated) throw new StockError("Le stock vient d'être modifié par quelqu'un d'autre : réessayez.");

  const [movement] = await StockMovementModel.create([{
    tenantId: input.tenantId, productId: product._id, type: input.type,
    quantity: delta, quantityBefore: before, quantityAfter: before + delta,
    reason: reason.slice(0, 300),
    linkedDocType: input.linkedDocType ?? "manual", linkedDocId: input.linkedDocId, linkedDocNumber: input.linkedDocNumber,
    unitCost: input.type === "entry" && unitCost > 0 ? unitCost : oldCost,
    avgCostAfter: newCost,
    createdBy: input.userId,
  }], { session });

  return { movement, before, after: before + delta, delta, avgCost: newCost };
}

/**
 * Annule un mouvement par un contre-mouvement (jamais d'effacement de
 * l'historique). Le contre-mouvement inverse l'écart réellement appliqué.
 */
export async function reverseMovement(opts: { tenantId: string; userId: string; movementId: unknown; reason?: string }, session?: ClientSession) {
  const m = await StockMovementModel.findOne({ _id: opts.movementId, tenantId: opts.tenantId }).session(session ?? null);
  if (!m) throw new StockError("Mouvement introuvable.");
  if (m.reversedBy) throw new StockError("Ce mouvement est déjà annulé.");
  if (m.reverses) throw new StockError("Une annulation ne s'annule pas : saisissez un nouveau mouvement.");
  const delta = -Number(m.quantity);
  if (delta === 0) throw new StockError("Ce mouvement n'a pas modifié le stock : rien à annuler.");
  const r = await applyMovement({
    tenantId: opts.tenantId, userId: opts.userId, productId: m.productId,
    type: delta >= 0 ? "return" : "exit", quantity: Math.abs(delta),
    reason: `Annulation — ${m.reason}${opts.reason ? ` (${opts.reason})` : ""}`,
    linkedDocType: "reversal", linkedDocId: m._id, linkedDocNumber: m.linkedDocNumber,
  }, session);
  await StockMovementModel.updateOne({ _id: r.movement._id }, { $set: { reverses: m._id } }, { session });
  m.reversedBy = r.movement._id;
  await m.save({ session });
  return r;
}
