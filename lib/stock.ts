import { Types, type ClientSession } from "mongoose";
import { ProductModel } from "@/models/Product";
import { StockMovementModel } from "@/models/StockMovement";
import { WarehouseModel } from "@/models/Warehouse";
import { ProductStockModel } from "@/models/ProductStock";
import { StockLotModel } from "@/models/StockLot";
import { BusinessRuleError } from "@/lib/errors";

export const MOVEMENT_TYPES = ["entry", "exit", "adjustment", "return", "loss"] as const;
export type MovementType = typeof MOVEMENT_TYPES[number];
export const MOVEMENT_LABEL: Record<MovementType | "transfer", string> = {
  entry: "Entrée", exit: "Sortie", adjustment: "Ajustement d'inventaire", return: "Retour", loss: "Perte / casse", transfer: "Transfert",
};

/** Refus métier : rendu en 400 avec son message, même levé au fond d'une transaction. */
export class StockError extends BusinessRuleError {}

export interface LotInput { lotNumber: string; expiryDate?: string | Date | null; qty: number }
interface LotAlloc { lotNumber: string; expiryDate?: Date; qty: number; unitCost?: number }

export interface MovementInput {
  tenantId: string;
  userId: string;
  productId: unknown;
  type: MovementType;
  /**
   * Quantité positive. Pour `adjustment`, c'est le stock réel constaté dans
   * l'entrepôt (le mouvement enregistré est l'écart). Article suivi par lot :
   * l'ajustement porte sur les lots fournis (quantité comptée de chacun).
   */
  quantity: number;
  /** Entrepôt ; à défaut, l'entrepôt par défaut de l'organisation. */
  warehouseId?: unknown;
  /** Lots / numéros de série (obligatoires en entrée pour un article suivi). */
  lots?: LotInput[];
  /** Coût unitaire d'achat, pour une entrée valorisée (met à jour le CMUP). */
  unitCost?: number;
  reason: string;
  linkedDocType?: string;
  linkedDocId?: unknown;
  linkedDocNumber?: string;
  /** Sortie au-delà du stock : refusée (défaut) ou plafonnée au stock disponible. */
  allowPartial?: boolean;
  /**
   * Entrée d'un article suivi par lot sans lot fourni (reprise, excédent
   * d'inventaire, réception sans numéro) : numéro du lot créé pour elle.
   */
  autoLot?: string;
  /** Sortie tolérante (vente déjà servie) : les lots périmés ne sortent pas, la sortie s'arrête aux lots valables. */
  skipExpired?: boolean;
}

type ProductLean = { _id: Types.ObjectId; label: string; stockQty?: number; purchaseCost?: number; isService?: boolean; trackingMode?: "none" | "lot" | "serial" };

// ── Entrepôts ────────────────────────────────────────────────────────────────

/** Entrepôt par défaut de l'organisation, créé au besoin (« Magasin principal »). */
export async function defaultWarehouse(tenantId: string, session?: ClientSession) {
  const tid = new Types.ObjectId(tenantId);
  let w = await WarehouseModel.findOne({ tenantId: tid, isDefault: true, isActive: true }).session(session ?? null).lean<{ _id: Types.ObjectId; name: string } | null>();
  if (w) return w;
  w = await WarehouseModel.findOne({ tenantId: tid, kind: "main", isActive: true }).session(session ?? null).lean<{ _id: Types.ObjectId; name: string } | null>();
  if (w) return w;
  try {
    const [c] = await WarehouseModel.create([{ tenantId: tid, code: "PRINC", name: "Magasin principal", kind: "main", isDefault: true }], { session });
    return { _id: c._id as Types.ObjectId, name: c.name as string };
  } catch {
    // Création concurrente : l'index unique (code) a tranché.
    const again = await WarehouseModel.findOne({ tenantId: tid, code: "PRINC" }).session(session ?? null).lean<{ _id: Types.ObjectId; name: string } | null>();
    if (!again) throw new StockError("Entrepôt par défaut introuvable.");
    return again;
  }
}

async function resolveWarehouse(tenantId: string, warehouseId: unknown, session?: ClientSession) {
  if (!warehouseId) return defaultWarehouse(tenantId, session);
  if (!Types.ObjectId.isValid(String(warehouseId))) throw new StockError("Entrepôt invalide.");
  const w = await WarehouseModel.findOne({ _id: warehouseId, tenantId, isActive: true }).session(session ?? null).lean<{ _id: Types.ObjectId; name: string } | null>();
  if (!w) throw new StockError("Entrepôt introuvable ou désactivé.");
  return w;
}

/**
 * Reprise : un article dont le stock existait avant les entrepôts (quantité
 * globale sans ligne par entrepôt) voit ce stock rangé dans l'entrepôt par
 * défaut ; s'il est suivi par lot, dans un lot « SANS-LOT ».
 */
export async function ensureStockRows(tenantId: string, product: ProductLean, session?: ClientSession) {
  const tid = new Types.ObjectId(tenantId);
  const rows = await ProductStockModel.countDocuments({ tenantId: tid, productId: product._id }).session(session ?? null);
  if (rows > 0 || !product.stockQty) return;
  const w = await defaultWarehouse(tenantId, session);
  try {
    await ProductStockModel.create([{ tenantId: tid, productId: product._id, warehouseId: w._id, qty: product.stockQty }], { session });
  } catch { return; }
  if (product.trackingMode && product.trackingMode !== "none") {
    await StockLotModel.updateOne(
      { tenantId: tid, productId: product._id, warehouseId: w._id, lotNumber: "SANS-LOT" },
      { $inc: { qty: product.stockQty }, $setOnInsert: { unitCost: product.purchaseCost ?? 0, receivedAt: new Date() } },
      { upsert: true, session },
    );
  }
}

async function stockRow(tenantId: string, productId: Types.ObjectId, warehouseId: Types.ObjectId, session?: ClientSession) {
  const tid = new Types.ObjectId(tenantId);
  let row = await ProductStockModel.findOne({ tenantId: tid, productId, warehouseId }).session(session ?? null).lean<{ qty: number } | null>();
  if (!row) {
    try { await ProductStockModel.create([{ tenantId: tid, productId, warehouseId, qty: 0 }], { session }); } catch { /* concurrent */ }
    row = { qty: 0 };
  }
  return row.qty ?? 0;
}

// ── Lots ─────────────────────────────────────────────────────────────────────

function cleanLots(raw: LotInput[] | undefined, serial: boolean): LotAlloc[] {
  const out: LotAlloc[] = [];
  for (const l of raw ?? []) {
    const lotNumber = String(l?.lotNumber ?? "").trim().slice(0, 80);
    const qty = Number(l?.qty);
    if (!lotNumber) throw new StockError("Numéro de lot / de série manquant.");
    if (!Number.isFinite(qty) || qty < 0) throw new StockError(`Quantité invalide pour le lot ${lotNumber}.`);
    if (serial && qty > 1) throw new StockError(`Numéro de série ${lotNumber} : une unité par numéro.`);
    const exp = l.expiryDate ? new Date(l.expiryDate) : undefined;
    if (exp && isNaN(exp.getTime())) throw new StockError(`Date de péremption invalide pour le lot ${lotNumber}.`);
    const existing = out.find(o => o.lotNumber === lotNumber);
    if (existing) { if (serial) throw new StockError(`Numéro de série ${lotNumber} en double.`); existing.qty += qty; }
    else out.push({ lotNumber, expiryDate: exp, qty });
  }
  return out;
}

/** Lots disponibles d'un article dans un entrepôt, péremption la plus proche d'abord (FEFO). */
async function availableLots(tenantId: string, productId: Types.ObjectId, warehouseId: Types.ObjectId, session?: ClientSession) {
  const lots = await StockLotModel.find({ tenantId: new Types.ObjectId(tenantId), productId, warehouseId, qty: { $gt: 0 } })
    .session(session ?? null).lean<Array<{ lotNumber: string; expiryDate?: Date; qty: number; unitCost?: number; receivedAt?: Date }>>();
  return lots.sort((a, b) => {
    const ea = a.expiryDate ? new Date(a.expiryDate).getTime() : Infinity;
    const eb = b.expiryDate ? new Date(b.expiryDate).getTime() : Infinity;
    if (ea !== eb) return ea - eb;
    return new Date(a.receivedAt ?? 0).getTime() - new Date(b.receivedAt ?? 0).getTime();
  });
}

/**
 * Lots périmés : `block` (vente, consommation) — jamais pris automatiquement,
 * refusés s'ils sont désignés ; `skip` (transfert) — écartés du choix
 * automatique mais transférables sur désignation (ex. vers une zone de
 * destruction) ; `allow` (perte, ajustement, annulation).
 */
type ExpiredPolicy = "block" | "skip" | "allow";
const isExpired = (d?: Date) => !!d && new Date(d).getTime() < new Date().setHours(0, 0, 0, 0);

async function takeLots(tenantId: string, product: ProductLean, warehouseId: Types.ObjectId, qty: number, wanted: LotAlloc[] | null, session?: ClientSession, expired: ExpiredPolicy = "allow", partial = false): Promise<LotAlloc[]> {
  const avail = await availableLots(tenantId, product._id, warehouseId, session);
  let plan: LotAlloc[];
  if (wanted && wanted.length) {
    const sum = wanted.reduce((s, l) => s + l.qty, 0);
    if (sum !== qty) throw new StockError(`Les lots indiqués totalisent ${sum}, la sortie porte sur ${qty}.`);
    plan = wanted.map(w => {
      const a = avail.find(x => x.lotNumber === w.lotNumber);
      if (!a || a.qty < w.qty) throw new StockError(`Lot ${w.lotNumber} : ${a?.qty ?? 0} disponible(s), ${w.qty} demandé(s).`);
      if (expired === "block" && isExpired(a.expiryDate)) throw new StockError(`Le lot ${w.lotNumber} est périmé : il ne peut pas être vendu ni consommé. Sortez-le en perte.`);
      return { lotNumber: w.lotNumber, expiryDate: a.expiryDate, qty: w.qty, unitCost: a.unitCost };
    });
  } else {
    plan = [];
    let rest = qty, skipped = 0;
    for (const a of avail) {
      if (rest <= 0) break;
      if (expired !== "allow" && isExpired(a.expiryDate)) { skipped += a.qty; continue; }
      const take = Math.min(a.qty, rest);
      plan.push({ lotNumber: a.lotNumber, expiryDate: a.expiryDate, qty: take, unitCost: a.unitCost });
      rest -= take;
    }
    if (rest > 0 && !partial) throw new StockError(`« ${product.label} » : lots insuffisants dans cet entrepôt (${qty - rest} disponible(s)${skipped ? `, sans compter ${skipped} périmé(s) à sortir en perte` : ""}).`);
  }
  for (const p of plan) {
    const r = await StockLotModel.updateOne(
      { tenantId: new Types.ObjectId(tenantId), productId: product._id, warehouseId, lotNumber: p.lotNumber, qty: { $gte: p.qty } },
      { $inc: { qty: -p.qty } }, { session },
    );
    if (!r.modifiedCount) throw new StockError(`Le lot ${p.lotNumber} vient d'être modifié : réessayez.`);
  }
  return plan;
}

async function putLots(tenantId: string, product: ProductLean, warehouseId: Types.ObjectId, lots: LotAlloc[], unitCost: number | undefined, session?: ClientSession) {
  const tid = new Types.ObjectId(tenantId);
  if (product.trackingMode === "serial") {
    for (const l of lots) {
      const dup = await StockLotModel.exists({ tenantId: tid, productId: product._id, lotNumber: l.lotNumber, qty: { $gt: 0 } }).session(session ?? null);
      if (dup) throw new StockError(`Le numéro de série ${l.lotNumber} est déjà en stock.`);
    }
  }
  for (const l of lots) {
    if (!(l.qty > 0)) continue;
    await StockLotModel.updateOne(
      { tenantId: tid, productId: product._id, warehouseId, lotNumber: l.lotNumber },
      {
        $inc: { qty: l.qty },
        $setOnInsert: { receivedAt: new Date(), unitCost: l.unitCost ?? unitCost ?? product.purchaseCost ?? 0 },
        ...(l.expiryDate ? { $set: { expiryDate: l.expiryDate } } : {}),
      },
      { upsert: true, session },
    );
  }
}

// ── Mouvement ────────────────────────────────────────────────────────────────

interface CoreInput extends Omit<MovementInput, "type"> {
  type: MovementType | "transfer";
  /** Transfert : sens de la jambe (+1 entrée dans l'entrepôt, -1 sortie). */
  direction?: 1 | -1;
  transferId?: Types.ObjectId;
  counterpartWarehouseId?: Types.ObjectId;
  /** Lots déjà affectés (jambe d'arrivée d'un transfert, annulation). */
  forcedLots?: LotAlloc[];
}

async function moveCore(input: CoreInput, session?: ClientSession) {
  const q = Number(input.quantity);
  if (!Number.isFinite(q) || q < 0 || (input.type !== "adjustment" && q === 0)) throw new StockError("Quantité invalide.");
  const reason = String(input.reason ?? "").trim();
  if (!reason) throw new StockError("Motif du mouvement obligatoire.");

  const product = await ProductModel.findOne({ _id: input.productId, tenantId: input.tenantId })
    .session(session ?? null).lean<ProductLean | null>();
  if (!product) throw new StockError("Produit introuvable.");
  if (product.isService) throw new StockError(`« ${product.label} » est un service : il n'a pas de stock.`);
  const tracked = product.trackingMode === "lot" || product.trackingMode === "serial";
  const serial = product.trackingMode === "serial";
  if (serial && !Number.isInteger(q)) throw new StockError("Article suivi par numéro de série : quantités entières.");

  await ensureStockRows(input.tenantId, product, session);
  const wh = await resolveWarehouse(input.tenantId, input.warehouseId, session);
  const before = await stockRow(input.tenantId, product._id, wh._id, session);

  // Écart sur l'entrepôt.
  let delta: number;
  let lotsIn: LotAlloc[] = [];
  let lotsOut: LotAlloc[] | null = null;
  const autoLots = !serial && input.autoLot && !input.lots?.length && !input.forcedLots
    && (input.type === "entry" || input.type === "return") ? [{ lotNumber: input.autoLot.slice(0, 80), qty: q }] : null;
  const given = input.forcedLots ?? (autoLots ? cleanLots(autoLots, false) : input.lots?.length ? cleanLots(input.lots, serial) : []);

  if (input.type === "adjustment") {
    if (tracked) {
      if (!given.length) throw new StockError("Article suivi par lot : indiquez le lot et sa quantité comptée.");
      const avail = await availableLots(input.tenantId, product._id, wh._id, session);
      delta = 0;
      lotsOut = [];
      for (const g of given) {
        const cur = avail.find(a => a.lotNumber === g.lotNumber)?.qty ?? 0;
        const d = g.qty - cur;
        if (d > 0) lotsIn.push({ ...g, qty: d });
        if (d < 0) lotsOut.push({ lotNumber: g.lotNumber, qty: -d });
        delta += d;
      }
    } else {
      delta = q - before;
    }
  } else if (input.type === "entry" || input.type === "return" || (input.type === "transfer" && input.direction === 1)) {
    delta = q;
    if (tracked) {
      if (!given.length) throw new StockError(`« ${product.label} » est suivi par ${serial ? "numéro de série" : "lot"} : indiquez ${serial ? "les numéros" : "le(s) lot(s)"}.`);
      const sum = given.reduce((s, l) => s + l.qty, 0);
      if (sum !== q) throw new StockError(`Les lots totalisent ${sum}, le mouvement porte sur ${q}.`);
      lotsIn = given;
    }
  } else {
    delta = -q;
    if (before + delta < 0) {
      if (!input.allowPartial) throw new StockError(`Stock insuffisant pour « ${product.label} » dans ${wh.name} : ${before} disponible(s), ${q} demandé(s).`);
      delta = -Math.max(0, before);
    }
    if (tracked && delta < 0) lotsOut = given.length ? given : null;
  }

  // Lots : sorties (FEFO si non précisées) puis entrées.
  let lotsTouched: LotAlloc[] = [];
  if (tracked) {
    if (input.type === "adjustment") {
      const outs = lotsOut ?? [];
      if (outs.length) {
        const taken = await takeLots(input.tenantId, product, wh._id, outs.reduce((s, l) => s + l.qty, 0), outs, session);
        lotsTouched.push(...taken.map(t => ({ ...t, qty: -t.qty })));
      }
      if (lotsIn.length) { await putLots(input.tenantId, product, wh._id, lotsIn, input.unitCost, session); lotsTouched.push(...lotsIn); }
    } else if (delta < 0) {
      const policy: ExpiredPolicy = input.skipExpired ? "skip" : input.type === "exit" && input.linkedDocType !== "reversal" ? "block" : input.type === "transfer" ? "skip" : "allow";
      const taken = await takeLots(input.tenantId, product, wh._id, -delta, lotsOut, session, policy, !!input.allowPartial && !lotsOut);
      // Sortie plafonnée : elle ne porte que sur ce que les lots valables ont fourni.
      if (input.allowPartial && !lotsOut) delta = -taken.reduce((t, l) => t + l.qty, 0);
      lotsTouched = taken.map(t => ({ ...t, qty: -t.qty }));
    } else if (delta > 0) {
      await putLots(input.tenantId, product, wh._id, lotsIn, input.unitCost, session);
      lotsTouched = lotsIn;
    }
  }

  // CMUP : seules les entrées d'achat valorisées le modifient.
  const totalBefore = product.stockQty ?? 0;
  const oldCost = product.purchaseCost ?? 0;
  const unitCost = Number(input.unitCost) > 0 ? Number(input.unitCost) : 0;
  let newCost = oldCost;
  if (input.type === "entry" && unitCost > 0 && delta > 0) {
    const base = Math.max(totalBefore, 0);
    newCost = Math.round(((base * oldCost + delta * unitCost) / (base + delta)) * 100) / 100;
  }

  // Entrepôt : mise à jour atomique (le stock n'a pas bougé depuis la lecture).
  const tid = new Types.ObjectId(input.tenantId);
  const upd = await ProductStockModel.updateOne({ tenantId: tid, productId: product._id, warehouseId: wh._id, qty: before }, { $inc: { qty: delta } }, { session });
  if (!upd.modifiedCount && delta !== 0) throw new StockError("Le stock vient d'être modifié par quelqu'un d'autre : réessayez.");
  const set: Record<string, unknown> = {};
  if (newCost !== oldCost) set.purchaseCost = newCost;
  if (input.type === "entry" && unitCost > 0) set.lastPurchaseCost = unitCost;
  await ProductModel.updateOne({ _id: product._id, tenantId: tid }, { $inc: { stockQty: delta }, ...(Object.keys(set).length ? { $set: set } : {}) }, { session });

  const [movement] = await StockMovementModel.create([{
    tenantId: input.tenantId, productId: product._id, type: input.type, warehouseId: wh._id,
    quantity: delta, quantityBefore: before, quantityAfter: before + delta, totalAfter: totalBefore + delta,
    lots: lotsTouched.map(l => ({ lotNumber: l.lotNumber, expiryDate: l.expiryDate, qty: l.qty })),
    transferId: input.transferId, counterpartWarehouseId: input.counterpartWarehouseId,
    reason: reason.slice(0, 300),
    linkedDocType: input.linkedDocType ?? "manual", linkedDocId: input.linkedDocId, linkedDocNumber: input.linkedDocNumber,
    unitCost: input.type === "entry" && unitCost > 0 ? unitCost : oldCost,
    avgCostAfter: newCost,
    createdBy: input.userId,
  }], { session });

  return { movement, before, after: before + delta, delta, avgCost: newCost, warehouseId: wh._id, lots: lotsTouched, totalAfter: totalBefore + delta };
}

/**
 * Seul point d'écriture du stock (entrées, sorties, ajustements, retours, pertes).
 *
 * - Par entrepôt : quantité de l'entrepôt ET total de l'article, mis à jour
 *   ensemble, de façon atomique ; une sortie ne passe pas sous zéro.
 * - Lots / séries : obligatoires en entrée pour un article suivi ; en sortie,
 *   lots précisés ou prélevés péremption la plus proche d'abord (FEFO).
 * - CMUP recalculé aux entrées valorisées.
 */
export async function applyMovement(input: MovementInput, session?: ClientSession) {
  if (!MOVEMENT_TYPES.includes(input.type)) throw new StockError("Type de mouvement inconnu.");
  return moveCore(input, session);
}

/**
 * Transfert entre deux entrepôts : sortie de l'un, entrée dans l'autre, mêmes
 * lots et dates de péremption, total et CMUP inchangés.
 */
export async function transferStock(input: {
  tenantId: string; userId: string; productId: unknown; fromWarehouseId: unknown; toWarehouseId: unknown;
  quantity: number; lots?: LotInput[]; reason: string; linkedDocType?: string; linkedDocId?: unknown; linkedDocNumber?: string;
}, session?: ClientSession) {
  const from = await resolveWarehouse(input.tenantId, input.fromWarehouseId, session);
  const to = await resolveWarehouse(input.tenantId, input.toWarehouseId, session);
  if (String(from._id) === String(to._id)) throw new StockError("Choisissez deux entrepôts différents.");
  const transferId = new Types.ObjectId();
  const reason = input.reason || `Transfert ${from.name} → ${to.name}`;
  const out = await moveCore({
    tenantId: input.tenantId, userId: input.userId, productId: input.productId, type: "transfer", direction: -1,
    quantity: input.quantity, warehouseId: from._id, lots: input.lots, reason, transferId, counterpartWarehouseId: to._id,
    linkedDocType: input.linkedDocType ?? "transfer", linkedDocId: input.linkedDocId, linkedDocNumber: input.linkedDocNumber,
  }, session);
  const inn = await moveCore({
    tenantId: input.tenantId, userId: input.userId, productId: input.productId, type: "transfer", direction: 1,
    quantity: input.quantity, warehouseId: to._id, forcedLots: out.lots.map(l => ({ ...l, qty: -l.qty })), reason, transferId,
    counterpartWarehouseId: from._id,
    linkedDocType: input.linkedDocType ?? "transfer", linkedDocId: input.linkedDocId, linkedDocNumber: input.linkedDocNumber,
  }, session);
  return { transferId, out, in: inn };
}

/**
 * Annule un mouvement par un contre-mouvement (jamais d'effacement de
 * l'historique) : même entrepôt, mêmes lots. Un transfert s'annule par le
 * transfert inverse (les deux jambes sont marquées).
 */
export async function reverseMovement(opts: { tenantId: string; userId: string; movementId: unknown; reason?: string }, session?: ClientSession) {
  const m = await StockMovementModel.findOne({ _id: opts.movementId, tenantId: opts.tenantId }).session(session ?? null);
  if (!m) throw new StockError("Mouvement introuvable.");
  if (m.reversedBy) throw new StockError("Ce mouvement est déjà annulé.");
  if (m.reverses) throw new StockError("Une annulation ne s'annule pas : saisissez un nouveau mouvement.");
  const delta = -Number(m.quantity);
  if (delta === 0) throw new StockError("Ce mouvement n'a pas modifié le stock : rien à annuler.");
  const lots: LotAlloc[] = (m.lots ?? []).map((l: LotAlloc) => ({ lotNumber: l.lotNumber, expiryDate: l.expiryDate, qty: Math.abs(l.qty) }));
  const why = `Annulation — ${m.reason}${opts.reason ? ` (${opts.reason})` : ""}`;

  if (m.type === "transfer" && m.transferId) {
    const legs = await StockMovementModel.find({ tenantId: opts.tenantId, transferId: m.transferId }).session(session ?? null);
    const outLeg = legs.find(l => Number(l.quantity) < 0), inLeg = legs.find(l => Number(l.quantity) > 0);
    if (!outLeg || !inLeg) throw new StockError("Transfert incomplet : annulation impossible.");
    if (outLeg.reversedBy || inLeg.reversedBy) throw new StockError("Ce transfert est déjà annulé.");
    const r = await transferStock({
      tenantId: opts.tenantId, userId: opts.userId, productId: m.productId, fromWarehouseId: inLeg.warehouseId, toWarehouseId: outLeg.warehouseId,
      quantity: Math.abs(Number(inLeg.quantity)), lots: (inLeg.lots ?? []).map((l: LotAlloc) => ({ lotNumber: l.lotNumber, expiryDate: l.expiryDate, qty: Math.abs(l.qty) })),
      reason: why, linkedDocType: "reversal", linkedDocId: m._id,
    }, session);
    await StockMovementModel.updateMany({ _id: { $in: [r.out.movement._id, r.in.movement._id] } }, { $set: { reverses: m._id } }, { session });
    await StockMovementModel.updateMany({ _id: { $in: [outLeg._id, inLeg._id] } }, { $set: { reversedBy: r.in.movement._id } }, { session });
    return r.in;
  }

  const r = await moveCore({
    tenantId: opts.tenantId, userId: opts.userId, productId: m.productId, warehouseId: m.warehouseId,
    type: delta >= 0 ? "return" : "exit", quantity: Math.abs(delta),
    ...(delta >= 0 ? { forcedLots: lots } : { lots: lots.length ? lots : undefined }),
    reason: why, linkedDocType: "reversal", linkedDocId: m._id, linkedDocNumber: m.linkedDocNumber,
  }, session);
  await StockMovementModel.updateOne({ _id: r.movement._id }, { $set: { reverses: m._id } }, { session });
  m.reversedBy = r.movement._id;
  await m.save({ session });
  return r;
}

/** Stock d'un article par entrepôt (avec reprise automatique de l'ancien stock global). */
export async function stockByWarehouse(tenantId: string, productId: unknown, session?: ClientSession) {
  const product = await ProductModel.findOne({ _id: productId, tenantId }).session(session ?? null).lean<ProductLean | null>();
  if (!product) return [];
  await ensureStockRows(tenantId, product, session);
  return ProductStockModel.find({ tenantId: new Types.ObjectId(tenantId), productId: product._id })
    .populate("warehouseId", "code name kind isActive").session(session ?? null).lean();
}

/** Reprise de l'ancien stock global pour tous les articles d'une organisation (appel idempotent). */
export async function migrateLegacyStock(tenantId: string) {
  const tid = new Types.ObjectId(tenantId);
  const withRows = await ProductStockModel.distinct("productId", { tenantId: tid });
  const legacy = await ProductModel.find({ tenantId: tid, stockQty: { $ne: 0 }, _id: { $nin: withRows } })
    .select("_id label stockQty purchaseCost isService trackingMode").limit(5000).lean<ProductLean[]>();
  for (const p of legacy) await ensureStockRows(tenantId, p);
}
