import { Types, type ClientSession } from "mongoose";
import { ActivityItemModel } from "@/models/ActivityItem";
import { ActivityStockMoveModel } from "@/models/ActivityStockMove";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { ComptoirSaleModel } from "@/models/ComptoirSale";
import { ItemCountModel } from "@/models/ItemCount";
import { ProductModel } from "@/models/Product";
import { EmployeeModel } from "@/models/Employee";
import { portionRecipe, RHYTHMS } from "@/lib/restaurant";
import { averageFactor } from "@/lib/restaurant-forecast";
import { ProductStockModel } from "@/models/ProductStock";
import { BusinessRuleError } from "@/lib/errors";
import { applyMovement } from "@/lib/stock";
import { deskWarehouse, syncLinkedItems } from "@/lib/comptoir-stock";
import { CommandeModel } from "@/models/Commande";
import { assertDayOpen, localDay } from "@/lib/comptoir-sale";
import { LOSS_REASONS, reorderSuggestion, pickCycleCount } from "@/lib/spot";
import { scheduledDemand } from "@/lib/campus-server";
import type { TokenPayload } from "@/lib/auth";

const DAY = 86_400_000;

/**
 * Perte, casse, offert, consommation du personnel : sortie de stock motivée,
 * valorisée au coût. Elle compte dans la marge de la semaine.
 */
type LossResult = { move: { _id: unknown } | null; lossValue: number };
export async function recordLoss(auth: TokenPayload, input: { deskId: string; itemId: string; quantity: number; reason: string; note?: string; date?: string; lenient?: boolean; employeeId?: string }, session?: ClientSession): Promise<LossResult> {
  const tenantId = auth.tenantId;
  if (!(input.reason in LOSS_REASONS)) throw new BusinessRuleError("Motif de perte inconnu.");
  // Les écarts d'inventaire ne se déclarent pas à la main : ils naissent d'un comptage validé.
  if (input.reason === "inventory") throw new BusinessRuleError("Un écart d'inventaire se constate par un inventaire, pas par une perte.");
  const qty = Number(input.quantity);
  if (!(qty > 0)) throw new BusinessRuleError("Quantité invalide.");
  const date = input.date ? new Date(input.date) : new Date();
  if (isNaN(date.getTime()) || date.getTime() > Date.now() + 3_600_000) throw new BusinessRuleError("Date invalide : une perte se déclare le jour où elle est constatée.");
  await assertDayOpen(tenantId, input.deskId, date, session);
  // Repas du personnel rattaché à un collaborateur de l'organisation (avantage en nature).
  if (input.reason === "staff" && input.employeeId && !input.lenient && !(/^[a-f0-9]{24}$/i.test(input.employeeId) && await EmployeeModel.exists({ _id: input.employeeId, tenantId }).session(session ?? null)))
    throw new BusinessRuleError("Collaborateur introuvable.");
  const item = await ActivityItemModel.findOne({ _id: input.itemId, tenantId, deskId: input.deskId }).session(session ?? null);
  if (!item) throw new BusinessRuleError("Article introuvable.");
  // Plat ou boisson préparé perdu (invendu, raté, retour) : ses ingrédients sortent du stock au coût de la recette.
  if (item.recipe?.length && item.productionMode !== "batch") {
    let lossValue = 0, move: LossResult["move"] = null;
    for (const ing of portionRecipe(item.recipe, item.portions)) {
      const r = await recordLoss(auth, { ...input, itemId: String(ing.itemId), quantity: Math.round(ing.quantity * qty * 10000) / 10000, note: `${item.name} × ${qty}${input.note ? ` — ${input.note}` : ""}`, lenient: true }, session);
      lossValue += r.lossValue; move = move ?? r.move;
    }
    return { move, lossValue };
  }
  const reason = `${LOSS_REASONS[input.reason]}${input.note ? ` — ${String(input.note).slice(0, 120)}` : ""}`;
  let unitCost = item.unitCost || 0, stockMovementId: unknown, after: number, out = qty;
  if (item.productId) {
    const wh = await deskWarehouse(tenantId, input.deskId, session);
    const r = await applyMovement({ tenantId, userId: auth.userId, productId: item.productId, warehouseId: wh, type: "loss", quantity: qty, reason, linkedDocType: "comptoir", linkedDocId: item.deskId, ...(input.lenient ? { allowPartial: true } : {}) }, session);
    unitCost = Number(r.movement.unitCost) || unitCost; stockMovementId = r.movement._id; after = r.after;
    // Sortie plafonnée au stock du comptoir : seule la quantité réellement sortie vaut perte, le reste ressortira à l'inventaire.
    out = Math.abs(Number(r.delta ?? qty));
  } else {
    // Perte déclarée à la caisse reliée (déjà constatée) : le stock tombe à 0 au pire.
    if (!input.lenient && qty > (item.quantity || 0)) throw new BusinessRuleError(`Stock insuffisant pour ${item.name} (${item.quantity} ${item.unit}).`);
    after = Math.max(0, Math.round(((item.quantity || 0) - qty) * 1000) / 1000);
  }
  const lossValue = Math.round(out * unitCost);
  const [move] = await ActivityStockMoveModel.create([{ tenantId, deskId: item.deskId, itemId: item._id, type: "out", quantity: out, quantityAfter: after, unitCost, reason, stockMovementId, lossReason: input.reason, lossValue, ...(input.reason === "staff" && input.employeeId && /^[a-f0-9]{24}$/i.test(input.employeeId) ? { employeeId: input.employeeId } : {}), date, createdBy: auth.userId }], { session });
  item.quantity = Math.max(0, after);
  await item.save({ session });
  return { move, lossValue };
}

/** Pertes d'une période : par motif et par article, valorisées au coût. */
export async function lossesReport(tenantId: string, deskId: unknown, fromDay: string, toDay: string) {
  const rows = await ActivityStockMoveModel.aggregate<{ _id: { r: string; i: Types.ObjectId }; qty: number; value: number }>([
    { $match: { tenantId: new Types.ObjectId(tenantId), deskId: new Types.ObjectId(String(deskId)), lossReason: { $exists: true }, date: { $gte: new Date(`${fromDay}T00:00:00.000`), $lte: new Date(`${toDay}T23:59:59.999`) } } },
    { $group: { _id: { r: "$lossReason", i: "$itemId" }, qty: { $sum: "$quantity" }, value: { $sum: "$lossValue" } } },
  ]);
  const names = new Map((await ActivityItemModel.find({ _id: { $in: rows.map(r => r._id.i) } }).select("name").lean<Array<{ _id: Types.ObjectId; name: string }>>()).map(i => [String(i._id), i.name]));
  const byReason = Object.keys(LOSS_REASONS).map(r => ({ reason: r, label: LOSS_REASONS[r], value: rows.filter(x => x._id.r === r).reduce((t, x) => t + x.value, 0) })).filter(x => x.value > 0);
  const byItem = [...new Set(rows.map(r => String(r._id.i)))].map(id => ({ itemId: id, label: names.get(id) ?? "—", quantity: rows.filter(r => String(r._id.i) === id).reduce((t, r) => t + r.qty, 0), value: rows.filter(r => String(r._id.i) === id).reduce((t, r) => t + r.value, 0) })).sort((a, b) => b.value - a.value);
  // Détail par article ET par motif (le résultat sépare les manquants d'inventaire des pertes déclarées).
  const detail = rows.map(r => ({ itemId: String(r._id.i), label: names.get(String(r._id.i)) ?? "—", reason: r._id.r, quantity: r.qty, value: r.value }));
  return { total: byReason.reduce((t, r) => t + r.value, 0), byReason, byItem, detail };
}

/**
 * Consommation par article sur `days` jours : ventes directes et
 * ingrédients sortis pour les préparations.
 */
export async function consumption(tenantId: string, deskId: unknown, days: number) {
  const since = new Date(Date.now() - days * DAY);
  const match = { tenantId: new Types.ObjectId(tenantId), deskId: new Types.ObjectId(String(deskId)), status: "paid", date: { $gte: since } };
  const [direct, ingredients] = await Promise.all([
    ComptoirSaleModel.aggregate<{ _id: Types.ObjectId; q: number; v: number }>([{ $match: match }, { $unwind: "$lines" }, { $match: { "lines.ingredients.0": { $exists: false } } }, { $group: { _id: "$lines.itemId", q: { $sum: "$lines.quantity" }, v: { $sum: "$lines.totalTTC" } } }]),
    ComptoirSaleModel.aggregate<{ _id: Types.ObjectId; q: number }>([{ $match: match }, { $unwind: "$lines" }, { $unwind: "$lines.ingredients" }, { $group: { _id: "$lines.ingredients.itemId", q: { $sum: "$lines.ingredients.quantity" } } }]),
  ]);
  // Ingrédients sortis pour une production par lot : c'est leur consommation réelle, la vente ne les touche pas.
  const produced = await ActivityStockMoveModel.aggregate<{ _id: Types.ObjectId; q: number }>([{ $match: { tenantId: match.tenantId, deskId: match.deskId, type: "out", reason: /^Production /, date: { $gte: since } } }, { $group: { _id: "$itemId", q: { $sum: "$quantity" } } }]);
  const out = new Map<string, { quantity: number; value: number }>();
  for (const r of direct) out.set(String(r._id), { quantity: r.q, value: r.v });
  for (const r of [...ingredients, ...produced]) { const c = out.get(String(r._id)) ?? { quantity: 0, value: 0 }; c.quantity += r.q; out.set(String(r._id), c); }
  return out;
}

/** Réassort conseillé de chaque article (sur les 28 derniers jours). */
export async function reorderPlan(tenantId: string, deskId: string) {
  const WINDOW = 28;
  // Stock des articles du catalogue à jour (livraison de la veille reçue en réserve).
  await syncLinkedItems(tenantId, deskId);
  const [desk, items, used] = await Promise.all([
    ActivityDeskModel.findOne({ _id: deskId, tenantId }).select("leadDays coverDays reserveWarehouseId").lean<{ leadDays?: number; coverDays?: number; reserveWarehouseId?: Types.ObjectId } | null>(),
    ActivityItemModel.find({ tenantId, deskId, archived: { $ne: true } }).lean<Array<{ _id: Types.ObjectId; name: string; unit: string; quantity: number; unitCost: number; threshold?: number; reserveThreshold?: number; productId?: Types.ObjectId; pack?: { label?: string; size?: number; cost?: number }; recipe?: unknown[]; rhythm?: string }>>(),
    consumption(tenantId, deskId, WINDOW),
  ]);
  // Déjà en commande pour ce comptoir (bons non reçus) : quantité restant à recevoir par article du catalogue.
  const open = await CommandeModel.find({ tenantId, sourceDeskId: new Types.ObjectId(String(deskId)), status: { $in: ["draft", "confirmed", "partially_received"] } })
    .select("lines.productId lines.quantity lines.receivedQty").lean<Array<{ lines: Array<{ productId?: Types.ObjectId; quantity?: number; receivedQty?: number }> }>>();
  const onOrder = new Map<string, number>();
  for (const c of open) for (const l of c.lines) if (l.productId) onOrder.set(String(l.productId), (onOrder.get(String(l.productId)) ?? 0) + Math.max(0, (l.quantity ?? 0) - (l.receivedQty ?? 0)));
  // Réserve du restaurant (stock en gros) : elle compte dans le stock disponible, avec son propre seuil.
  const reserveRows = desk?.reserveWarehouseId
    ? await ProductStockModel.find({ tenantId, warehouseId: desk.reserveWarehouseId, productId: { $in: items.map(i => i.productId).filter(Boolean) } }).select("productId qty").lean<Array<{ productId: Types.ObjectId; qty: number }>>()
    : [];
  const reserve = new Map(reserveRows.map(r => [String(r.productId), Math.max(0, r.qty)]));
  const lead = desk?.leadDays ?? 2, cover = desk?.coverDays ?? 7;
  // Campus : la demande vient de l'emploi du temps (vacances, examens, jours
  // sans cours) plutôt que de la moyenne des 28 derniers jours.
  const planned = await scheduledDemand(tenantId, deskId, localDay(new Date(Date.now() + DAY)), lead + cover);
  // Vacances, fêtes, promotions du site : la demande de la période à couvrir suit ses événements.
  const firstDay = localDay(new Date(Date.now() + DAY)), factors = new Map<number, number>();
  for (const n of new Set(items.map(i => lead + (i.rhythm && i.rhythm in RHYTHMS ? RHYTHMS[i.rhythm as keyof typeof RHYTHMS].days : cover)))) factors.set(n, await averageFactor(tenantId, deskId, firstDay, n));
  const products = await ProductModel.find({ tenantId, _id: { $in: items.map(i => i.productId).filter(Boolean) } }).select("preferredSupplierId purchaseCost").populate("preferredSupplierId", "name").lean<Array<{ _id: Types.ObjectId; purchaseCost?: number; preferredSupplierId?: { _id: Types.ObjectId; name: string } }>>();
  const prod = new Map(products.map(p => [String(p._id), p]));
  const lines = items.filter(i => !i.recipe?.length).map(i => {
    const inReserve = i.productId ? reserve.get(String(i.productId)) ?? 0 : 0;
    const stock = i.quantity + inReserve;
    // Rythme de l'article : le réassort couvre sa période (semaine, deux semaines, mois).
    const cov = i.rhythm && i.rhythm in RHYTHMS ? RHYTHMS[i.rhythm as keyof typeof RHYTHMS].days : cover;
    const threshold = i.threshold != null || i.reserveThreshold != null ? (i.threshold ?? 0) + (i.reserveThreshold ?? 0) : undefined;
    // L'emploi du temps du campus porte déjà ses vacances : l'événement n'est appliqué que sur la moyenne des ventes.
    const demand = factors.get(lead + cov) ?? 1;
    const s = planned
      ? reorderSuggestion({ stock, soldInWindow: planned.get(String(i._id)) ?? 0, windowDays: lead + cover, leadDays: lead, coverDays: cov, packSize: i.pack?.size, threshold, onOrder: i.productId ? onOrder.get(String(i.productId)) : 0 })
      : reorderSuggestion({ stock, soldInWindow: (used.get(String(i._id))?.quantity ?? 0) * demand, windowDays: WINDOW, leadDays: lead, coverDays: cov, packSize: i.pack?.size, threshold, onOrder: i.productId ? onOrder.get(String(i.productId)) : 0 });
    const p = i.productId ? prod.get(String(i.productId)) : undefined;
    const unitCost = p?.purchaseCost || i.unitCost || 0;
    return {
      itemId: String(i._id), name: i.name, unit: i.unit, stock, reserve: inReserve, ...s, packLabel: i.pack?.label, packSize: i.pack?.size ?? null,
      estimatedCost: Math.round(s.quantity * unitCost), linked: !!i.productId, productId: i.productId ? String(i.productId) : null,
      supplier: p?.preferredSupplierId ? { _id: String(p.preferredSupplierId._id), name: p.preferredSupplierId.name } : null,
    };
  }).sort((a, b) => Number(b.urgent) - Number(a.urgent) || (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9));
  return { leadDays: lead, coverDays: cover, windowDays: WINDOW, basis: planned ? "schedule" as const : "history" as const, lines, toOrder: lines.filter(l => l.quantity > 0), totalCost: lines.reduce((t, l) => t + l.estimatedCost, 0) };
}

/** Articles à compter aujourd'hui (inventaire tournant) et comptages déjà faits. */
export async function cycleCountPlan(tenantId: string, deskId: string) {
  const today = localDay(new Date());
  const [desk, items, sold, last, done, losses] = await Promise.all([
    ActivityDeskModel.findOne({ _id: deskId, tenantId }).select("cycleCountSize").lean<{ cycleCountSize?: number } | null>(),
    ActivityItemModel.find({ tenantId, deskId, archived: { $ne: true }, $or: [{ recipe: { $exists: false } }, { recipe: { $size: 0 } }] }).lean<Array<{ _id: Types.ObjectId; name: string; unit: string; quantity: number; unitCost: number }>>(),
    consumption(tenantId, deskId, 28),
    ItemCountModel.aggregate<{ _id: Types.ObjectId; day: string }>([{ $match: { tenantId: new Types.ObjectId(tenantId), deskId: new Types.ObjectId(deskId) } }, { $group: { _id: "$itemId", day: { $max: "$day" } } }]),
    ItemCountModel.find({ tenantId, deskId, day: today }).lean<Array<{ itemId: Types.ObjectId; expected: number; counted: number; gap: number; gapValue: number }>>(),
    ActivityStockMoveModel.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { tenantId: new Types.ObjectId(tenantId), deskId: new Types.ObjectId(deskId), lossReason: { $exists: true }, date: { $gte: new Date(Date.now() - 28 * DAY) } } }, { $group: { _id: "$itemId", n: { $sum: 1 } } }]),
  ]);
  const lastBy = new Map(last.map(l => [String(l._id), l.day]));
  const lossBy = new Map(losses.map(l => [String(l._id), l.n]));
  const candidates = items.map(i => {
    const d = lastBy.get(String(i._id));
    return { itemId: String(i._id), stockValue: i.quantity * (i.unitCost || 0), soldValue: sold.get(String(i._id))?.value ?? 0, lastCountedDays: d ? Math.round((new Date(`${today}T12:00:00`).getTime() - new Date(`${d}T12:00:00`).getTime()) / DAY) : null, recentLosses: lossBy.get(String(i._id)) ?? 0 };
  });
  const doneIds = new Set(done.map(d => String(d.itemId)));
  const picked = done.length ? [...doneIds] : pickCycleCount(candidates, desk?.cycleCountSize ?? 5);
  const byId = new Map(items.map(i => [String(i._id), i]));
  return {
    day: today,
    items: picked.map(id => byId.get(id)).filter(Boolean).map(i => ({ itemId: String(i!._id), name: i!.name, unit: i!.unit, counted: done.find(d => String(d.itemId) === String(i!._id)) ?? null, lastCounted: lastBy.get(String(i!._id)) ?? null })),
    doneToday: done.length,
  };
}

/** Enregistre les comptages du jour et aligne le stock (écart valorisé). */
export async function recordCounts(auth: TokenPayload, deskId: string, counts: Array<{ itemId: string; counted: number }>, session?: ClientSession, opts: { recount?: boolean; reason?: string } = {}) {
  const tenantId = auth.tenantId;
  const day = localDay(new Date());
  const reason = opts.reason ?? "Inventaire tournant";
  await assertDayOpen(tenantId, deskId, new Date(), session);
  const results = [];
  for (const c of counts) {
    const counted = Number(c.counted);
    if (!(counted >= 0)) throw new BusinessRuleError("Quantité comptée invalide.");
    const item = await ActivityItemModel.findOne({ _id: c.itemId, tenantId, deskId }).session(session ?? null);
    if (!item) throw new BusinessRuleError("Article introuvable.");
    // Inventaire reçu de la caisse reliée : un second comptage du jour est permis (il fait foi).
    if (!opts.recount && await ItemCountModel.exists({ tenantId, deskId, itemId: item._id, day }).session(session ?? null)) throw new BusinessRuleError(`${item.name} : déjà compté aujourd'hui.`);
    const expected = item.quantity || 0;
    const gap = Math.round((counted - expected) * 1000) / 1000;
    // Site ouvert par l'assistant : un écart se justifie dans un inventaire. La caisse reliée, elle, constate et ne se refuse pas.
    if (gap !== 0 && !opts.recount && await ActivityDeskModel.exists({ _id: deskId, tenantId, strictStock: true }).session(session ?? null)) throw new BusinessRuleError(`${item.name} : écart de ${gap}. Recomptez, ou passez par un inventaire pour le justifier.`);
    let unitCost = item.unitCost || 0, stockMovementId: unknown;
    if (gap !== 0) {
      if (item.productId) {
        const wh = await deskWarehouse(tenantId, deskId, session);
        const r = await applyMovement({ tenantId, userId: auth.userId, productId: item.productId, warehouseId: wh, type: gap < 0 ? "loss" : "return", quantity: Math.abs(gap), allowPartial: true, autoLot: `INV-${day}`, reason, linkedDocType: "comptoir", linkedDocId: item.deskId }, session);
        unitCost = Number(r.movement.unitCost) || unitCost; stockMovementId = r.movement._id;
      }
      await ActivityStockMoveModel.create([{ tenantId, deskId, itemId: item._id, type: "adjust", quantity: Math.abs(gap), quantityAfter: counted, unitCost, reason, stockMovementId,
        ...(gap < 0 ? { lossReason: "inventory", lossValue: Math.round(-gap * unitCost) } : {}), date: new Date(), createdBy: auth.userId }], { session });
      item.quantity = counted;
      await item.save({ session });
    }
    const [doc] = await ItemCountModel.create([{ tenantId, deskId, itemId: item._id, day, expected, counted, gap, gapValue: Math.round(gap * unitCost), countedBy: auth.userId }], { session });
    results.push({ itemId: String(item._id), name: item.name, expected, counted, gap, gapValue: doc.gapValue });
  }
  return results;
}
