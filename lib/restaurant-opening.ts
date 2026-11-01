import { Types } from "mongoose";
import { withTransaction } from "@/lib/db";
import { ActivityModel } from "@/models/Activity";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { ActivityItemModel } from "@/models/ActivityItem";
import { ActivityStockMoveModel } from "@/models/ActivityStockMove";
import { DeskInventoryModel } from "@/models/DeskInventory";
import { ItemCountModel } from "@/models/ItemCount";
import { ProductModel } from "@/models/Product";
import { ProductStockModel } from "@/models/ProductStock";
import { StockLotModel } from "@/models/StockLot";
import { TreasuryAccountModel } from "@/models/TreasuryAccount";
import { UserModel } from "@/models/User";
import { BusinessRuleError } from "@/lib/errors";
import { applyMovement } from "@/lib/stock";
import { deskWarehouse, syncLinkedItems } from "@/lib/comptoir-stock";
import { deskReserve, ensureLinked } from "@/lib/restaurant-stock";
import { validateStaff } from "@/lib/restaurant-team";
import { nextLedgerCode, registerLedgerAccount } from "@/lib/treasury";
import { CHARGE_CATEGORIES, RHYTHMS } from "@/lib/restaurant";
import { localDay } from "@/lib/format";
import type { TokenPayload } from "@/lib/auth";

type Id = Types.ObjectId;
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * État des restaurants avant un nouveau départ : pour chacun, articles, stock
 * restant (comptoir et réserve) en quantité et au coût, inventaires ouverts.
 * Rien n'est modifié.
 */
export async function restartReport(tenantId: string) {
  const desks = await ActivityDeskModel.find({ tenantId, archived: { $ne: true } }).select("name warehouseId reserveWarehouseId treasuryAccountId").lean<Array<{ _id: Id; name: string; warehouseId?: Id; reserveWarehouseId?: Id; treasuryAccountId?: Id }>>();
  return Promise.all(desks.map(async d => {
    const whs = [d.warehouseId, d.reserveWarehouseId].filter(Boolean) as Id[];
    const [items, stock, open] = await Promise.all([
      ActivityItemModel.countDocuments({ tenantId, deskId: d._id, archived: { $ne: true } }),
      whs.length ? ProductStockModel.find({ tenantId, warehouseId: { $in: whs }, qty: { $ne: 0 } }).select("productId warehouseId qty").lean<Array<{ productId: Id; warehouseId: Id; qty: number }>>() : Promise.resolve([]),
      DeskInventoryModel.countDocuments({ tenantId, deskId: d._id, status: "open" }),
    ]);
    const products = await ProductModel.find({ tenantId, _id: { $in: stock.map(s => s.productId) } }).select("label avgCost purchaseCost").lean<Array<{ _id: Id; label: string; avgCost?: number; purchaseCost?: number }>>();
    const lines = stock.map(s => { const p = products.find(x => String(x._id) === String(s.productId)); const c = p?.avgCost || p?.purchaseCost || 0; return { product: p?.label ?? "—", qty: s.qty, value: Math.round(s.qty * c), negative: s.qty < 0 }; });
    return { deskId: String(d._id), name: d.name, items, openInventories: open, stockLines: lines.length, stockValue: lines.reduce((t, l) => t + l.value, 0), negatives: lines.filter(l => l.negative).length, stock: lines };
  }));
}

/**
 * Nouveau départ : les restaurants désignés sont ARCHIVÉS, pas supprimés —
 * ventes, caisses, écritures comptables et mouvements restent consultables
 * et les mois passés inchangés. Le comptoir prend « (archivé AAAA-MM-JJ) »
 * dans son nom pour libérer le nom ; ses articles sont archivés ; ses
 * inventaires ouverts annulés. Avec `solderStock`, le stock restant des deux
 * niveaux est ramené à zéro par un ajustement tracé (« Clôture avant nouveau
 * départ »), pour qu'il ne compte pas deux fois avec le stock d'ouverture des
 * nouveaux sites. La comptabilité de clôture reste à valider par la comptable.
 */
export async function archiveForRestart(auth: TokenPayload, deskIds: string[], solderStock: boolean) {
  const day = localDay(new Date());
  const out: Array<{ name: string; soldLines: number }> = [];
  for (const id of deskIds) {
    const d = await ActivityDeskModel.findOne({ _id: id, tenantId: auth.tenantId, archived: { $ne: true } }).select("name warehouseId reserveWarehouseId").lean<{ _id: Id; name: string; warehouseId?: Id; reserveWarehouseId?: Id } | null>();
    if (!d) throw new BusinessRuleError("Restaurant introuvable ou déjà archivé.");
    let sold = 0;
    await withTransaction(async session => {
      if (solderStock) {
        const whs = [d.warehouseId, d.reserveWarehouseId].filter(Boolean) as Id[];
        const rows = whs.length ? await ProductStockModel.find({ tenantId: auth.tenantId, warehouseId: { $in: whs }, qty: { $ne: 0 } }).select("productId warehouseId").session(session ?? null).lean<Array<{ productId: Id; warehouseId: Id }>>() : [];
        for (const s of rows) {
          // Article suivi par lot : chaque lot encore présent est compté à zéro.
          const lots = await StockLotModel.find({ tenantId: auth.tenantId, productId: s.productId, warehouseId: s.warehouseId, qty: { $ne: 0 } }).select("lotNumber").session(session ?? null).lean<Array<{ lotNumber: string }>>();
          await applyMovement({ tenantId: auth.tenantId, userId: auth.userId, productId: s.productId, warehouseId: s.warehouseId, type: "adjustment", quantity: 0,
            ...(lots.length ? { lots: lots.map(l => ({ lotNumber: l.lotNumber, qty: 0 })) } : {}),
            reason: `Clôture avant nouveau départ (${day}) — ${d.name}`, linkedDocType: "inventory", linkedDocId: d._id, linkedDocNumber: `CLOTURE-${day}` }, session);
          sold++;
        }
      }
      await DeskInventoryModel.updateMany({ tenantId: auth.tenantId, deskId: d._id, status: "open" }, { $set: { status: "cancelled", note: `Annulé : nouveau départ du ${day}` } }, { session });
      await ActivityItemModel.updateMany({ tenantId: auth.tenantId, deskId: d._id, archived: { $ne: true } }, { $set: { archived: true } }, { session });
      await ActivityDeskModel.updateOne({ _id: d._id, tenantId: auth.tenantId }, { $set: { archived: true, name: `${d.name} (archivé ${day})`.slice(0, 120) } }, { session });
    });
    out.push({ name: d.name, soldLines: sold });
  }
  return out;
}

export interface OpeningItem {
  productId?: string; name?: string; unit?: string; category?: string;
  salePrice?: number; unitCost: number; pack?: { label?: string; size?: number };
  threshold?: number; rhythm?: string;
  level: "reserve" | "desk"; quantity?: number; packs?: number;
  lotNumber?: string; expiryDate?: string;
}
export interface OpeningInput {
  name: string; openingDate?: string; vatRate?: number; targetNetMargin?: number; revenueAccount?: string;
  cash: { label?: string; openingBalance: number };
  staff?: Array<{ employeeId: string; share: number }>;
  userIds?: string[];
  plannedCosts?: Array<{ category: string; amount: number }>;
  commonCostShare?: number;
  items?: OpeningItem[];
}

/**
 * Ouverture d'un site en une fois : secteur analytique propre, caisse avec
 * son montant de départ (fonds de caisse), comptoir et réserve, personnel
 * affecté, accès des comptes utilisateurs, charges prévues par rubrique,
 * articles et STOCK D'OUVERTURE (entrée tracée au coût, hors achats et hors
 * résultat). La nature comptable du montant de départ (apport, avance,
 * fonds propres) est à enregistrer par la comptable.
 */
export async function openSite(auth: TokenPayload, i: OpeningInput, canManageUsers: boolean) {
  const name = String(i.name ?? "").trim().slice(0, 120);
  if (!name) throw new BusinessRuleError("Nom du site obligatoire.");
  if (await ActivityDeskModel.exists({ tenantId: auth.tenantId, name })) throw new BusinessRuleError("Un site porte déjà ce nom.");
  const openingBalance = Number(i.cash?.openingBalance ?? 0);
  if (!Number.isFinite(openingBalance) || openingBalance < 0) throw new BusinessRuleError("Montant de départ invalide.");
  const date = i.openingDate && /^\d{4}-\d{2}-\d{2}$/.test(i.openingDate) ? new Date(`${i.openingDate}T07:00:00`) : new Date();
  const vat = Number(i.vatRate ?? 0);
  if (!(vat >= 0 && vat <= 0.5)) throw new BusinessRuleError("Taux de TVA invalide.");
  const target = i.targetNetMargin === undefined ? 0.2 : Number(i.targetNetMargin);
  if (!(target >= 0 && target <= 0.9)) throw new BusinessRuleError("Marge nette visée invalide.");
  const planned = (i.plannedCosts ?? []).filter(p => p.category in CHARGE_CATEGORIES && Number(p.amount) > 0).map(p => ({ category: p.category, amount: Math.round(Number(p.amount)) }));
  const share = i.commonCostShare === undefined ? undefined : Number(i.commonCostShare);
  if (share !== undefined && !(share >= 0 && share <= 1)) throw new BusinessRuleError("Quote-part des charges communes invalide.");
  if (i.userIds?.length && !canManageUsers) throw new BusinessRuleError("L'accès des comptes utilisateurs au site revient à qui gère les utilisateurs.");

  // 1. Secteur, caisse, comptoir (une transaction).
  const desk = await withTransaction(async session => {
    const [sector] = await ActivityModel.create([{ tenantId: auth.tenantId, name, createdBy: auth.userId }], { session });
    const label = (i.cash?.label || `Caisse ${name}`).slice(0, 120);
    const ledgerCode = await nextLedgerCode(auth.tenantId, "cash", session);
    const [caisse] = await TreasuryAccountModel.create([{ tenantId: auth.tenantId, label, type: "cash", currency: "XOF", openingBalance, openingDate: date, ledgerCode }], { session });
    await registerLedgerAccount(auth.tenantId, ledgerCode, label, session);
    const [d] = await ActivityDeskModel.create([{
      tenantId: auth.tenantId, name, activityId: sector._id, treasuryAccountId: caisse._id, vatRate: vat, targetNetMargin: target,
      ...(i.revenueAccount && /^7\d{2,7}$/.test(i.revenueAccount) ? { revenueAccount: i.revenueAccount } : {}),
      ...(planned.length ? { plannedCosts: planned } : {}), ...(share !== undefined ? { commonCostShare: share } : {}), createdBy: auth.userId,
    }], { session });
    return d;
  });
  const deskId = String(desk._id);
  await Promise.all([deskWarehouse(auth.tenantId, desk._id), deskReserve(auth.tenantId, deskId)]);

  // 2. Personnel affecté (à partir de la date d'ouverture) et accès des comptes.
  if (i.staff?.length) {
    const staff = await validateStaff(auth.tenantId, deskId, i.staff.map(s => ({ ...s, from: localDay(date) })));
    await ActivityDeskModel.updateOne({ _id: desk._id }, { $set: { staff } });
  }
  if (i.userIds?.length) {
    const ids = i.userIds.filter(u => /^[a-f0-9]{24}$/i.test(u));
    await UserModel.updateMany({ _id: { $in: ids }, tenantId: auth.tenantId }, { $addToSet: { siteIds: desk._id } });
  }

  // 3. Articles et stock d'ouverture.
  const stock = await openingStock(auth, deskId, i.items ?? [], date);
  return { deskId, name, ...stock };
}

/**
 * Stock d'ouverture d'un site : chaque article (repris du catalogue ou créé)
 * entre au coût indiqué, en réserve ou au comptoir, par une entrée tracée
 * « Stock d'ouverture » — ni achat, ni dette fournisseur, ni résultat. Un
 * inventaire d'ouverture validé en garde la liste.
 */
export async function openingStock(auth: TokenPayload, deskId: string, items: OpeningItem[], date = new Date()) {
  if (items.length > 500) throw new BusinessRuleError("500 articles au plus par ouverture.");
  if (!(await ActivityDeskModel.exists({ _id: deskId, tenantId: auth.tenantId, archived: { $ne: true } }))) throw new BusinessRuleError("Site introuvable.");
  const day = localDay(date);
  const byLevel: Record<"desk" | "reserve", Array<{ itemId: Id; name: string; unit: string; counted: number; unitCost: number }>> = { desk: [], reserve: [] };
  let value = 0;
  for (const it of items) {
    const cost = Number(it.unitCost);
    if (!(cost >= 0)) throw new BusinessRuleError(`${it.name ?? "Article"} : coût invalide.`);
    let product: { _id: Id; label: string; unit?: string; category?: string } | null = null;
    if (it.productId) {
      product = await ProductModel.findOne({ _id: it.productId, tenantId: auth.tenantId }).select("label unit category").lean<{ _id: Id; label: string; unit?: string; category?: string } | null>();
      if (!product) throw new BusinessRuleError("Article du catalogue introuvable.");
    }
    const name = (product?.label ?? it.name ?? "").trim().slice(0, 160);
    if (!name) throw new BusinessRuleError("Nom de l'article obligatoire.");
    const size = it.pack?.size && it.pack.size >= 1 ? Math.round(it.pack.size) : undefined;
    const qty = Number(it.packs) > 0 ? (size ? Number(it.packs) * size : NaN) : Number(it.quantity ?? 0);
    if (!(qty >= 0) || qty > 1e7) throw new BusinessRuleError(`${name} : quantité invalide${Number(it.packs) > 0 && !size ? " (pas de conditionnement)" : ""}.`);
    // Article du site : repris s'il existe déjà (même produit ou même nom), sinon créé.
    let item = await ActivityItemModel.findOne({ tenantId: auth.tenantId, deskId, archived: { $ne: true }, ...(product ? { productId: product._id } : { name }) }).select("_id").lean<{ _id: Id } | null>();
    if (!item) {
      const [c] = await ActivityItemModel.create([{
        tenantId: auth.tenantId, deskId, name, unit: (it.unit || product?.unit || "unité").slice(0, 24), quantity: 0, unitCost: cost,
        ...(product ? { productId: product._id } : {}), ...((it.category || product?.category) ? { category: (it.category || product?.category)!.slice(0, 60) } : {}),
        ...(Number(it.salePrice) > 0 ? { salePrice: Math.round(Number(it.salePrice)) } : {}), ...(size ? { pack: { label: (it.pack?.label || "carton").slice(0, 30), size } } : {}),
        ...(Number(it.threshold) > 0 ? { threshold: Number(it.threshold) } : {}), ...(it.rhythm && it.rhythm in RHYTHMS ? { rhythm: it.rhythm } : {}),
        createdBy: auth.userId,
      }]);
      item = { _id: c._id as Id };
    }
    if (!(qty > 0)) continue;
    await withTransaction(async session => {
      const productId = await ensureLinked(auth, deskId, item!._id, session);
      const wh = it.level === "desk" ? await deskWarehouse(auth.tenantId, deskId, session) : await deskReserve(auth.tenantId, deskId, session);
      const r = await applyMovement({
        tenantId: auth.tenantId, userId: auth.userId, productId, warehouseId: wh, type: "entry", quantity: qty, unitCost: cost,
        ...(it.lotNumber || it.expiryDate ? { lots: [{ lotNumber: (it.lotNumber || `OUV-${day}`).slice(0, 80), qty, ...(it.expiryDate ? { expiryDate: it.expiryDate } : {}) }] } : { autoLot: `OUV-${day}` }),
        reason: `Stock d'ouverture du ${day}`, linkedDocType: "inventory", linkedDocId: new Types.ObjectId(deskId), linkedDocNumber: `OUV-${day}`,
      }, session);
      await ActivityItemModel.updateOne({ _id: item!._id }, { $set: { unitCost: cost } }, { session });
      if (it.level === "desk") await ActivityStockMoveModel.create([{ tenantId: auth.tenantId, deskId, itemId: item!._id, type: "in", quantity: qty, quantityAfter: r.after, unitCost: cost, reason: `Stock d'ouverture du ${day}`, stockMovementId: r.movement._id, date, createdBy: auth.userId }], { session });
    });
    byLevel[it.level === "desk" ? "desk" : "reserve"].push({ itemId: item._id, name, unit: (it.unit || product?.unit || "unité"), counted: qty, unitCost: cost });
    value += qty * cost;
  }
  // Inventaires d'ouverture (déjà validés) : la liste comptée, hors résultat.
  for (const level of ["desk", "reserve"] as const) {
    const lines = byLevel[level];
    if (!lines.length) continue;
    const gapValue = Math.round(lines.reduce((t, l) => t + l.counted * l.unitCost, 0));
    await DeskInventoryModel.create({
      tenantId: auth.tenantId, deskId, number: `OUV-${day.replace(/-/g, "")}-${level === "desk" ? "C" : "R"}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`, level, status: "validated", opening: true,
      lines: lines.map(l => ({ itemId: l.itemId, name: l.name, unit: l.unit, counted: l.counted, expected: 0, gap: l.counted, unitCost: l.unitCost, gapValue: Math.round(l.counted * l.unitCost), countedBy: auth.userId, countedAt: date })),
      gapValue, startedBy: auth.userId, validatedBy: auth.userId, validatedAt: date, note: "Stock d'ouverture saisi à la création du site",
    });
  }
  // Comptages du comptoir, comme un inventaire d'ouverture validé : le résultat les retranche (stock initial, pas un gain).
  if (byLevel.desk.length) await ItemCountModel.insertMany(byLevel.desk.map(l => ({ tenantId: auth.tenantId, deskId, itemId: l.itemId, day, expected: 0, counted: l.counted, gap: l.counted, gapValue: Math.round(l.counted * l.unitCost), countedBy: auth.userId })));
  await syncLinkedItems(auth.tenantId, deskId);
  return { items: items.length, stockValue: Math.round(value), desk: byLevel.desk.length, reserve: byLevel.reserve.length, rounded: r2(value) };
}
