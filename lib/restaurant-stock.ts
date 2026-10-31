import { Types, type ClientSession } from "mongoose";
import { withTransaction } from "@/lib/db";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { ActivityItemModel } from "@/models/ActivityItem";
import { ActivityStockMoveModel } from "@/models/ActivityStockMove";
import { ActivityCashEntryModel } from "@/models/ActivityCashEntry";
import { WarehouseModel } from "@/models/Warehouse";
import { ProductModel } from "@/models/Product";
import { ProductStockModel } from "@/models/ProductStock";
import { StockLotModel } from "@/models/StockLot";
import { StockMovementModel } from "@/models/StockMovement";
import { BusinessRuleError } from "@/lib/errors";
import { applyMovement, transferStock, type LotInput } from "@/lib/stock";
import { deskWarehouse, syncLinkedItems } from "@/lib/comptoir-stock";
import { postDeskCash } from "@/lib/comptoir";
import { assertDayOpen, assertMonthOpen } from "@/lib/comptoir-sale";
import { costRise, supplySuggestion } from "@/lib/restaurant";
import { LOSS_REASONS } from "@/lib/spot";
import type { TokenPayload } from "@/lib/auth";

/**
 * Stock du restaurant à deux niveaux, dans le comptoir :
 *  - la RÉSERVE (stock en gros : cartons, sacs, bidons), un entrepôt de la
 *    gestion de stock propre au comptoir (lots, péremptions, CMUP) ;
 *  - le COMPTOIR (stock de vente), l'entrepôt « comptoir » déjà existant.
 * Les articles y passent par le catalogue : un article du comptoir non relié
 * l'est automatiquement (une fiche catalogue créée à son nom).
 * Réception fournisseur → réserve ; « Approvisionner le comptoir » = transfert
 * réserve → comptoir ; « Retour en réserve » = l'inverse. Tout est tracé.
 */

type Id = Types.ObjectId;

/**
 * Réserve du comptoir, créée à la demande (entrepôt « store »). Création
 * atomique : deux premiers affichages simultanés ne créent qu'un entrepôt.
 */
export async function deskReserve(tenantId: string, deskId: unknown, session?: ClientSession): Promise<Id> {
  const desk = await ActivityDeskModel.findOne({ _id: deskId, tenantId }).select("name reserveWarehouseId").session(session ?? null)
    .lean<{ _id: Id; name: string; reserveWarehouseId?: Id } | null>();
  if (!desk) throw new BusinessRuleError("Comptoir introuvable.");
  if (desk.reserveWarehouseId && await WarehouseModel.exists({ _id: desk.reserveWarehouseId, tenantId, deskId: desk._id }).session(session ?? null)) return desk.reserveWarehouseId;
  // Code tiré de l'identifiant complet du comptoir : pas de collision entre deux comptoirs.
  // Code de 20 caractères au plus (limite des entrepôts) : les 16 derniers caractères de l'identifiant du comptoir.
  const code = `RES-${String(desk._id).slice(-16).toUpperCase()}`;
  let wh: { _id: Id; deskId?: Id } | null;
  try {
    wh = await WarehouseModel.findOneAndUpdate({ tenantId, code },
      { $setOnInsert: { tenantId, code, name: `Réserve ${desk.name}`, kind: "store", deskId: desk._id } },
      { upsert: true, new: true, session }).select("_id deskId").lean<{ _id: Id; deskId?: Id }>();
  } catch (e) {
    if ((e as { code?: number })?.code !== 11000) throw e;
    wh = await WarehouseModel.findOne({ tenantId, code }).select("_id deskId").session(session ?? null).lean<{ _id: Id; deskId?: Id } | null>();
  }
  if (!wh || String(wh.deskId) !== String(desk._id)) throw new BusinessRuleError("Réserve du comptoir introuvable.");
  await ActivityDeskModel.updateOne({ _id: desk._id, tenantId }, { $set: { reserveWarehouseId: wh._id } }, { session });
  return wh._id;
}

type ItemDoc = { _id: Id; deskId: Id; name: string; unit: string; quantity: number; unitCost: number; salePrice?: number; category?: string; barcode?: string; sku?: string; productId?: Id };

/**
 * Relie un article du comptoir au catalogue en créant sa fiche : même nom,
 * unité, code-barres et coût ; TAUX DE TVA DU COMPTOIR et prix HT (la fiche
 * fait foi pour la TVA des ventes) ; suivi par lot, pour garder les dates de
 * péremption. Son stock propre entre au comptoir (reprise tracée).
 * À appeler dans une transaction : la liaison est revendiquée d'abord, une
 * seconde liaison simultanée ne reprend pas le stock deux fois.
 */
export async function ensureLinked(auth: TokenPayload, deskId: unknown, itemId: unknown, session?: ClientSession): Promise<Id> {
  const it = await ActivityItemModel.findOne({ _id: itemId, tenantId: auth.tenantId, deskId }).session(session ?? null).lean<ItemDoc | null>();
  if (!it) throw new BusinessRuleError("Article du comptoir introuvable.");
  if (it.productId) return it.productId;
  const desk = await ActivityDeskModel.findOne({ _id: it.deskId, tenantId: auth.tenantId }).select("vatRate").session(session ?? null).lean<{ vatRate?: number } | null>();
  const vat = desk?.vatRate ?? 0;
  const code = `RST-${String(it._id).toUpperCase()}`;
  let product = await ProductModel.findOne({ tenantId: auth.tenantId, code }).select("_id").session(session ?? null).lean<{ _id: Id } | null>();
  if (!product) {
    const [p] = await ProductModel.create([{
      tenantId: auth.tenantId, code, label: it.name, unit: it.unit || "unité",
      unitPrice: Math.round((it.salePrice ?? 0) / (1 + vat)), tvaRate: vat, stockQty: 0, purchaseCost: it.unitCost || 0, trackingMode: "lot",
      ...(it.category ? { category: it.category } : {}), ...(it.barcode ? { barcode: it.barcode } : {}),
    }], { session });
    product = { _id: p._id as Id };
  }
  const claim = await ActivityItemModel.updateOne({ _id: it._id, tenantId: auth.tenantId, productId: { $exists: false } }, { $set: { productId: product._id } }, { session });
  if (claim.modifiedCount !== 1) {
    const again = await ActivityItemModel.findOne({ _id: it._id }).select("productId").session(session ?? null).lean<{ productId?: Id } | null>();
    if (again?.productId) return again.productId;
    throw new BusinessRuleError("Liaison au catalogue impossible : réessayez.");
  }
  if ((it.quantity ?? 0) > 0) {
    const whId = await deskWarehouse(auth.tenantId, it.deskId, session);
    await applyMovement({
      tenantId: auth.tenantId, userId: auth.userId, productId: product._id, type: "entry", warehouseId: whId,
      quantity: it.quantity, unitCost: it.unitCost || undefined, reason: `Reprise du stock du comptoir (${it.name})`, linkedDocType: "comptoir", linkedDocId: it._id,
      autoLot: "REPRISE-COMPTOIR",
    }, session);
  }
  return product._id;
}

export interface StockRow {
  itemId: string; name: string; unit: string; category?: string; barcode?: string; linked: boolean; preparation: boolean;
  pack: { label?: string; size?: number } | null;
  desk: number; reserve: number; total: number; unitCost: number | null; value: number | null;
  threshold?: number; reserveThreshold?: number; lowDesk: boolean; lowReserve: boolean;
  nextExpiry: string | null; expiringQty: number; expiredQty: number; suggestion: number;
}

/** Les deux niveaux de stock d'un comptoir, article par article. `costs` : coûts visibles. */
export async function restaurantStock(tenantId: string, deskId: string, costs: boolean, now = new Date()): Promise<{ reserveId: string; rows: StockRow[]; totals: { desk: number | null; reserve: number | null } }> {
  await syncLinkedItems(tenantId, deskId);
  const [reserveId, deskWh] = await Promise.all([deskReserve(tenantId, deskId), deskWarehouse(tenantId, deskId)]);
  const items = await ActivityItemModel.find({ tenantId, deskId, archived: { $ne: true } }).sort({ category: 1, name: 1 })
    .lean<Array<ItemDoc & { threshold?: number; reserveThreshold?: number; pack?: { label?: string; size?: number }; recipe?: unknown[] }>>();
  const pids = items.map(i => i.productId).filter(Boolean) as Id[];
  const [res, lots] = await Promise.all([
    ProductStockModel.find({ tenantId, warehouseId: reserveId, productId: { $in: pids } }).select("productId qty").lean<Array<{ productId: Id; qty: number }>>(),
    StockLotModel.find({ tenantId, warehouseId: { $in: [reserveId, deskWh] }, productId: { $in: pids }, qty: { $gt: 0 }, expiryDate: { $ne: null } })
      .select("productId warehouseId expiryDate qty").sort({ expiryDate: 1 }).lean<Array<{ productId: Id; expiryDate: Date; qty: number }>>(),
  ]);
  const reserveQty = new Map(res.map(r => [String(r.productId), r.qty]));
  const reserveLots = lots.filter(l => String((l as { warehouseId?: Id }).warehouseId) === String(reserveId));
  // Jugé au jour local : un lot est périmé le lendemain de sa date limite, comme au blocage des ventes.
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const soon = today.getTime() + 8 * 86_400_000;
  const rows: StockRow[] = items.map(i => {
    const pid = i.productId ? String(i.productId) : "";
    const reserve = pid ? Math.max(0, reserveQty.get(pid) ?? 0) : 0;
    const desk = Math.max(0, i.quantity || 0);
    const own = lots.filter(l => String(l.productId) === pid);
    const unitCost = costs ? i.unitCost || 0 : null;
    return {
      itemId: String(i._id), name: i.name, unit: i.unit, category: i.category, barcode: i.barcode, linked: !!pid, preparation: !!i.recipe?.length,
      pack: i.pack?.size ? { label: i.pack.label, size: i.pack.size } : null,
      desk, reserve, total: desk + reserve, unitCost, value: unitCost === null ? null : Math.round((desk + reserve) * unitCost),
      threshold: i.threshold, reserveThreshold: i.reserveThreshold,
      lowDesk: i.threshold != null && desk <= i.threshold, lowReserve: i.reserveThreshold != null && reserve <= i.reserveThreshold,
      nextExpiry: own[0] ? own[0].expiryDate.toISOString().slice(0, 10) : null,
      expiringQty: own.filter(l => l.expiryDate.getTime() < soon && l.expiryDate.getTime() >= today.getTime()).reduce((t, l) => t + l.qty, 0),
      expiredQty: own.filter(l => l.expiryDate.getTime() < today.getTime()).reduce((t, l) => t + l.qty, 0),
      // Les lots périmés de la réserve ne montent pas au comptoir : ils ne comptent pas dans la suggestion.
      suggestion: supplySuggestion({ desk, reserve: Math.max(0, reserve - reserveLots.filter(l => String(l.productId) === pid && l.expiryDate.getTime() < today.getTime()).reduce((t, l) => t + l.qty, 0)), threshold: i.threshold, packSize: i.pack?.size }),
    };
  });
  const sum = (f: (r: StockRow) => number) => rows.reduce((t, r) => t + f(r), 0);
  return {
    reserveId: String(reserveId), rows,
    totals: costs ? { desk: Math.round(sum(r => r.desk * (r.unitCost ?? 0))), reserve: Math.round(sum(r => r.reserve * (r.unitCost ?? 0))) } : { desk: null, reserve: null },
  };
}

export interface ReceiveLine { itemId: string; quantity?: number; packs?: number; unitCost?: number; packCost?: number; lotNumber?: string; expiryDate?: string }

const METHODS = ["cash", "bank_transfer", "orange_money", "card", "check", "other"];
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
/** Référence unique d'un mouvement (jour, heure, comptoir) : un bon par opération. */
const ref = (prefix: string, deskId: unknown) => {
  const d = new Date(), p = (n: number) => String(n).padStart(2, "0");
  return `${prefix}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${String(deskId).slice(-4).toUpperCase()}`;
};

/**
 * Réception en réserve (marché, livraison sans bon de commande) : entrée
 * valorisée (met à jour le CMUP), lot et date de péremption gardés. Payée
 * depuis la caisse du comptoir : la sortie de caisse est passée avec elle
 * (achats du comptoir, 601). Sans prix (magasinier qui ne voit pas les
 * coûts), elle reste « à valoriser » et apparaît comme telle au résultat.
 * Renvoie les hausses de coût et les préparations qu'elles touchent.
 */
export async function receiveInReserve(auth: TokenPayload, deskId: string, lines: ReceiveLine[], meta: { supplier?: string; reference?: string; paidFromCash?: boolean; method?: string; date?: string }) {
  if (!lines.length) throw new BusinessRuleError("Aucun article reçu.");
  const date = meta.date ? new Date(meta.date) : new Date();
  if (isNaN(date.getTime()) || date.getTime() > Date.now() + 3_600_000) throw new BusinessRuleError("Date de réception invalide.");
  const method = METHODS.includes(String(meta.method)) ? String(meta.method) : "cash";
  const supplier = text(meta.supplier, 120), reference = text(meta.reference, 60);
  const alerts: Array<{ name: string; before: number; after: number; pct: number; dishes: string[] }> = [];
  let unvalued = 0;
  const total = await withTransaction(async session => {
    alerts.length = 0; unvalued = 0;
    // La réserve ne touche pas la caisse : seul le mois clos l'arrête ; payée depuis la caisse, la journée doit être ouverte.
    if (meta.paidFromCash) await assertDayOpen(auth.tenantId, deskId, date, session);
    else await assertMonthOpen(auth.tenantId, deskId, date, session);
    const reserveId = await deskReserve(auth.tenantId, deskId, session);
    let sum = 0;
    for (const l of lines) {
      const it = await ActivityItemModel.findOne({ _id: l.itemId, tenantId: auth.tenantId, deskId }).session(session ?? null)
        .lean<ItemDoc & { pack?: { size?: number; cost?: number }; recipe?: unknown[] } | null>();
      if (!it) throw new BusinessRuleError("Article du comptoir introuvable.");
      if (it.recipe?.length) throw new BusinessRuleError(`${it.name} est une préparation : recevez ses ingrédients.`);
      const size = it.pack?.size ?? 0;
      const qty = Number(l.packs) > 0 ? (size ? Number(l.packs) * size : NaN) : Number(l.quantity);
      if (!(qty > 0) || qty > 1e7) throw new BusinessRuleError(`${it.name} : quantité invalide${Number(l.packs) > 0 && !size ? " (pas de conditionnement : saisissez des unités)" : ""}.`);
      const unitCost = Number(l.packCost) > 0 && size ? Number(l.packCost) / size : Number(l.unitCost) > 0 ? Number(l.unitCost) : undefined;
      const expiry = text(l.expiryDate, 10);
      if (expiry && isNaN(new Date(expiry).getTime())) throw new BusinessRuleError(`${it.name} : date de péremption invalide.`);
      const productId = await ensureLinked(auth, deskId, it._id, session);
      const p = await ProductModel.findOne({ _id: productId, tenantId: auth.tenantId }).select("purchaseCost trackingMode").session(session ?? null).lean<{ purchaseCost?: number; trackingMode?: string } | null>();
      const tracked = p?.trackingMode === "lot" || p?.trackingMode === "serial";
      if (!tracked && expiry) throw new BusinessRuleError(`${it.name} n'est pas suivi par lot dans le catalogue : sa date de péremption ne serait pas gardée. Activez le suivi par lot dans sa fiche ou laissez la date vide.`);
      const lots: LotInput[] | undefined = tracked
        ? [{ lotNumber: text(l.lotNumber, 80) || `REC-${date.toISOString().slice(0, 10)}`, qty, ...(expiry ? { expiryDate: expiry } : {}) }]
        : undefined;
      await applyMovement({
        tenantId: auth.tenantId, userId: auth.userId, productId, type: "entry", warehouseId: reserveId, quantity: qty,
        ...(unitCost !== undefined ? { unitCost } : {}), lots,
        reason: `Réception en réserve${supplier ? ` — ${supplier}` : ""}${reference ? ` (${reference})` : ""}${unitCost === undefined ? " — à valoriser" : ""}`.slice(0, 300),
        linkedDocType: "comptoir", linkedDocId: it.deskId, ...(reference ? { linkedDocNumber: reference } : {}),
      }, session);
      if (unitCost === undefined) { unvalued++; continue; }
      sum += qty * unitCost;
      const rise = costRise(p?.purchaseCost ?? 0, unitCost);
      if (rise) {
        const dishes = await ActivityItemModel.find({ tenantId: auth.tenantId, deskId, "recipe.itemId": it._id, archived: { $ne: true } }).select("name").session(session ?? null).lean<Array<{ name: string }>>();
        alerts.push({ name: it.name, before: p?.purchaseCost ?? 0, after: unitCost, pct: rise, dishes: dishes.map(d => d.name) });
      }
    }
    if (meta.paidFromCash && sum > 0) {
      const [cash] = await ActivityCashEntryModel.create([{
        tenantId: auth.tenantId, deskId, direction: "out", amount: Math.round(sum), label: `Achat en réserve${supplier ? ` — ${supplier}` : ""}${reference ? ` (${reference})` : ""}`.slice(0, 200),
        method, category: "purchase", date, createdBy: auth.userId,
      }], { session });
      await postDeskCash(auth, deskId, cash, session);
    }
    return Math.round(sum);
  });
  await syncLinkedItems(auth.tenantId, deskId);
  return { total, alerts, unvalued };
}

/**
 * Approvisionnement du comptoir depuis sa réserve (ou retour en réserve) :
 * transfert dans la gestion de stock (lots et péremptions suivent, le plus
 * proche d'abord ; un lot périmé reste en réserve), tracé des deux côtés,
 * sous un numéro de bon propre à l'opération.
 */
export async function moveBetweenLevels(auth: TokenPayload, deskId: string, lines: Array<{ itemId: string; quantity?: number; packs?: number }>, direction: "supply" | "return") {
  if (!lines.length) throw new BusinessRuleError("Aucun article.");
  const desk = await ActivityDeskModel.findOne({ _id: deskId, tenantId: auth.tenantId }).select("name").lean<{ _id: Id; name: string } | null>();
  if (!desk) throw new BusinessRuleError("Comptoir introuvable.");
  const reference = ref(direction === "supply" ? "APR" : "RTR", desk._id);
  await withTransaction(async session => {
    await assertMonthOpen(auth.tenantId, deskId, new Date(), session);
    const [reserveId, deskWh] = await Promise.all([deskReserve(auth.tenantId, deskId, session), deskWarehouse(auth.tenantId, deskId, session)]);
    for (const l of lines) {
      const it = await ActivityItemModel.findOne({ _id: l.itemId, tenantId: auth.tenantId, deskId }).select("name pack").session(session ?? null)
        .lean<{ _id: Id; name: string; pack?: { size?: number } } | null>();
      if (!it) throw new BusinessRuleError("Article du comptoir introuvable.");
      const qty = Number(l.packs) > 0 ? Number(l.packs) * (it.pack?.size ?? NaN) : Number(l.quantity);
      if (!(qty > 0)) throw new BusinessRuleError(`${it.name} : quantité invalide.`);
      const productId = await ensureLinked(auth, deskId, it._id, session);
      const r = await transferStock({
        tenantId: auth.tenantId, userId: auth.userId, productId,
        fromWarehouseId: direction === "supply" ? reserveId : deskWh, toWarehouseId: direction === "supply" ? deskWh : reserveId,
        quantity: qty, reason: `${direction === "supply" ? "Approvisionnement du comptoir depuis la réserve" : "Retour en réserve"} — ${desk.name}`,
        linkedDocType: "comptoir", linkedDocId: desk._id, linkedDocNumber: reference,
      }, session);
      const leg = direction === "supply" ? r.in : r.out;
      await ActivityStockMoveModel.create([{
        tenantId: auth.tenantId, deskId, itemId: it._id, type: direction === "supply" ? "supply" : "return", quantity: qty, quantityAfter: leg.after,
        reason: `${direction === "supply" ? "Depuis la réserve" : "Retour en réserve"} (${reference})`, stockMovementId: leg.movement._id, date: new Date(), createdBy: auth.userId,
      }], { session });
    }
  });
  await syncLinkedItems(auth.tenantId, deskId);
  return { reference };
}

/**
 * Perte constatée en réserve (carton périmé, sac abîmé) : sortie de la
 * réserve, lots les plus proches de la péremption d'abord, comptée dans les
 * pertes du comptoir au coût.
 */
export async function reserveLoss(auth: TokenPayload, deskId: string, lines: Array<{ itemId: string; quantity?: number; packs?: number }>, reason: string, note?: string) {
  if (!(reason in LOSS_REASONS) || reason === "inventory") throw new BusinessRuleError("Motif de perte inconnu.");
  if (!lines.length) throw new BusinessRuleError("Aucun article.");
  const reference = ref("PRS", deskId);
  let value = 0;
  await withTransaction(async session => {
    value = 0;
    await assertMonthOpen(auth.tenantId, deskId, new Date(), session);
    const reserveId = await deskReserve(auth.tenantId, deskId, session);
    for (const l of lines) {
      const it = await ActivityItemModel.findOne({ _id: l.itemId, tenantId: auth.tenantId, deskId }).select("name pack productId quantity unitCost").session(session ?? null)
        .lean<{ _id: Id; name: string; pack?: { size?: number }; productId?: Id; quantity: number; unitCost?: number } | null>();
      if (!it?.productId) throw new BusinessRuleError("Article absent de la réserve.");
      const qty = Number(l.packs) > 0 ? Number(l.packs) * (it.pack?.size ?? NaN) : Number(l.quantity);
      if (!(qty > 0)) throw new BusinessRuleError(`${it.name} : quantité invalide.`);
      const label = `Perte en réserve : ${LOSS_REASONS[reason].toLowerCase()}${note ? ` — ${text(note, 120)}` : ""} (${reference})`;
      const r = await applyMovement({ tenantId: auth.tenantId, userId: auth.userId, productId: it.productId, warehouseId: reserveId, type: "loss", quantity: qty, reason: label, linkedDocType: "comptoir", linkedDocId: deskId, linkedDocNumber: reference }, session);
      const unitCost = Number(r.movement.unitCost) || it.unitCost || 0, lossValue = Math.round(qty * unitCost);
      value += lossValue;
      // Trace côté comptoir pour le rapport des pertes et le résultat (le stock du comptoir ne bouge pas).
      await ActivityStockMoveModel.create([{ tenantId: auth.tenantId, deskId, itemId: it._id, type: "out", quantity: qty, quantityAfter: it.quantity || 0, unitCost, reason: label, stockMovementId: r.movement._id, lossReason: reason, lossValue, date: new Date(), createdBy: auth.userId }], { session });
    }
  });
  return { reference, value };
}

/** Flux de la réserve (entrées, transferts, ajustements), les plus récents d'abord. */
export async function reserveMoves(tenantId: string, deskId: string, limit = 100) {
  const reserveId = await deskReserve(tenantId, deskId);
  const moves = await StockMovementModel.find({ tenantId, warehouseId: reserveId }).sort({ createdAt: -1 }).limit(limit)
    .select("productId type quantity quantityAfter unitCost reason linkedDocNumber lots createdAt").lean<Array<{ productId: Id; type: string; quantity: number; quantityAfter: number; unitCost?: number; reason: string; linkedDocNumber?: string; createdAt: Date }>>();
  const items = await ActivityItemModel.find({ tenantId, deskId, productId: { $in: moves.map(m => m.productId) } }).select("name unit productId").lean<Array<{ name: string; unit: string; productId: Id }>>();
  const by = new Map(items.map(i => [String(i.productId), i]));
  return moves.map(m => ({ ...m, name: by.get(String(m.productId))?.name ?? "—", unit: by.get(String(m.productId))?.unit ?? "" }));
}
