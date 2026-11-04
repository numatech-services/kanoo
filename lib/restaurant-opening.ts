import { Types } from "mongoose";
import { withTransaction } from "@/lib/db";
import { ActivityModel } from "@/models/Activity";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { ActivityItemModel } from "@/models/ActivityItem";
import { ActivityStockMoveModel } from "@/models/ActivityStockMove";
import { CashSessionModel } from "@/models/CashSession";
import { DeskFundingModel } from "@/models/DeskFunding";
import { DeskInventoryModel } from "@/models/DeskInventory";
import { DeskTransferModel } from "@/models/DeskTransfer";
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
import { accountBalance, nextLedgerCode, registerLedgerAccount } from "@/lib/treasury";
import { allocateFunds, transferFunds, type FundingNature, FUNDING_NATURES } from "@/lib/restaurant-funding";
import { CHARGE_CATEGORIES, RHYTHMS } from "@/lib/restaurant";
import { localDay } from "@/lib/format";
import type { TokenPayload } from "@/lib/auth";

type Id = Types.ObjectId;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
interface DeskRow { _id: Id; name: string; warehouseId?: Id; reserveWarehouseId?: Id; treasuryAccountId?: Id; staff?: unknown[]; plannedCosts?: unknown[]; openingDate?: Date }

/** Stock restant d'un site, au coût : quantité par ligne, et stocks négatifs à part. */
async function stockOf(tenantId: string, d: DeskRow) {
  const whs = [d.warehouseId, d.reserveWarehouseId].filter(Boolean) as Id[];
  const stock = whs.length ? await ProductStockModel.find({ tenantId, warehouseId: { $in: whs }, qty: { $ne: 0 } }).select("productId qty").lean<Array<{ productId: Id; qty: number }>>() : [];
  const products = await ProductModel.find({ tenantId, _id: { $in: stock.map(s => s.productId) } }).select("label purchaseCost").lean<Array<{ _id: Id; label: string; purchaseCost?: number }>>();
  const lines = stock.map(s => { const p = products.find(x => String(x._id) === String(s.productId)); return { product: p?.label ?? "—", qty: s.qty, value: Math.round(s.qty * (p?.purchaseCost ?? 0)) }; });
  return { lines: lines.length, value: lines.reduce((t, l) => t + l.value, 0), negatives: lines.filter(l => l.qty < 0).length };
}

/**
 * Les sites actifs et leur état d'ouverture : articles, stock au coût, caisse,
 * argent alloué, agents, charges prévues, caisse ouverte, ce qui reste à
 * faire. Rien n'est modifié.
 */
export async function sitesOverview(tenantId: string) {
  const desks = await ActivityDeskModel.find({ tenantId, archived: { $ne: true } }).select("name warehouseId reserveWarehouseId treasuryAccountId staff plannedCosts openingDate").sort({ name: 1 }).lean<DeskRow[]>();
  return Promise.all(desks.map(async d => {
    const [stock, items, openInventories, session, funding, pending, balance] = await Promise.all([
      stockOf(tenantId, d),
      ActivityItemModel.countDocuments({ tenantId, deskId: d._id, archived: { $ne: true } }),
      DeskInventoryModel.countDocuments({ tenantId, deskId: d._id, status: "open" }),
      CashSessionModel.exists({ tenantId, deskId: d._id, status: "open" }),
      DeskFundingModel.find({ tenantId, deskId: d._id, kind: "money", cancelledAt: { $exists: false } }).select("amount").lean<Array<{ amount: number }>>(),
      DeskTransferModel.countDocuments({ tenantId, status: { $in: ["sent", "transit"] }, $or: [{ fromDeskId: d._id }, { toDeskId: d._id }] }),
      d.treasuryAccountId ? accountBalance(tenantId, String(d.treasuryAccountId)) : Promise.resolve(null),
    ]);
    const funded = funding.reduce((t, f) => t + f.amount, 0);
    return {
      deskId: String(d._id), name: d.name, openingDate: d.openingDate ?? null, items, openInventories, stockLines: stock.lines, stockValue: stock.value, negatives: stock.negatives,
      hasCash: !!d.treasuryAccountId, cashBalance: balance?.balance ?? null, funded, staff: (d.staff ?? []).length, planned: (d.plannedCosts ?? []).length,
      sessionOpen: !!session, pendingTransfers: pending,
      todo: [...(!d.treasuryAccountId ? ["caisse"] : !funded && !(balance?.balance) ? ["montant de départ"] : []), ...(!stock.lines ? ["stock de départ"] : []), ...(!(d.staff ?? []).length ? ["agents"] : []), ...(!(d.plannedCosts ?? []).length ? ["charges prévues"] : [])],
    };
  }));
}

/**
 * Nouveau départ : les sites désignés sont ARCHIVÉS, pas supprimés : ventes,
 * caisses, écritures et mouvements restent consultables, les mois passés
 * inchangés. Refusé tant qu'une caisse est ouverte ou qu'un transfert attend :
 * ce serait perdre de la marchandise ou des espèces en route. Le site prend
 * « (archivé AAAA-MM-JJ) » dans son nom pour le libérer ; articles archivés ;
 * inventaires ouverts annulés. `solderStock` : le stock restant passe à zéro
 * par un ajustement tracé, pour ne pas compter deux fois avec le stock
 * d'ouverture des nouveaux sites. `cashTo` : le solde de sa caisse est viré sur
 * ce compte (virement interne), sinon il y reste et le rapport le montre.
 */
export async function archiveForRestart(auth: TokenPayload, deskIds: string[], solderStock: boolean, cashTo?: string) {
  const day = localDay(new Date());
  const out: Array<{ name: string; soldLines: number; cashMoved: number }> = [];
  for (const id of deskIds) {
    const d = await ActivityDeskModel.findOne({ _id: id, tenantId: auth.tenantId, archived: { $ne: true } }).select("name warehouseId reserveWarehouseId treasuryAccountId").lean<DeskRow | null>();
    if (!d) throw new BusinessRuleError("Site introuvable ou déjà archivé.");
    if (await CashSessionModel.exists({ tenantId: auth.tenantId, deskId: d._id, status: "open" })) throw new BusinessRuleError(`${d.name} : fermez d'abord sa caisse.`);
    if (await DeskTransferModel.exists({ tenantId: auth.tenantId, status: { $in: ["sent", "transit"] }, $or: [{ fromDeskId: d._id }, { toDeskId: d._id }] })) throw new BusinessRuleError(`${d.name} : un transfert attend d'être reçu.`);
    let sold = 0, moved = 0;
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
      if (cashTo && d.treasuryAccountId && String(d.treasuryAccountId) !== cashTo) {
        const bal = await accountBalance(auth.tenantId, String(d.treasuryAccountId), session);
        if (bal && bal.balance > 0) {
          await transferFunds(auth, { fromAccountId: d.treasuryAccountId, toAccountId: cashTo, amount: bal.balance, date: new Date(), label: `Solde de caisse — clôture de ${d.name}`.slice(0, 200), reference: `CLOTURE-${day}` }, session);
          moved = bal.balance;
        }
      }
      await DeskInventoryModel.updateMany({ tenantId: auth.tenantId, deskId: d._id, status: "open" }, { $set: { status: "cancelled", note: `Annulé : nouveau départ du ${day}` } }, { session });
      await ActivityItemModel.updateMany({ tenantId: auth.tenantId, deskId: d._id, archived: { $ne: true } }, { $set: { archived: true } }, { session });
      await ActivityDeskModel.updateOne({ _id: d._id, tenantId: auth.tenantId }, { $set: { archived: true, name: `${d.name} (archivé ${day})`.slice(0, 120) } }, { session });
    });
    out.push({ name: d.name, soldLines: sold, cashMoved: moved });
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
  cash?: { label?: string };
  funding?: { amount: number; nature: FundingNature; fromAccountId?: string; label?: string };
  staff?: Array<{ employeeId: string; share: number }>;
  userIds?: string[];
  plannedCosts?: Array<{ category: string; amount: number }>;
  commonCostShare?: number;
  items?: OpeningItem[];
  copyFromDeskId?: string;
}

const qtyOf = (it: OpeningItem, name: string) => {
  const size = it.pack?.size && it.pack.size >= 1 ? Math.round(it.pack.size) : undefined;
  const packs = Number(it.packs) || 0, units = Number(it.quantity ?? 0);
  if (packs < 0 || units < 0 || !Number.isFinite(packs) || !Number.isFinite(units)) throw new BusinessRuleError(`${name} : quantité invalide.`);
  if (packs > 0 && !size) throw new BusinessRuleError(`${name} : indiquez la taille du carton.`);
  const q = packs * (size ?? 0) + units;
  if (q > 1e7) throw new BusinessRuleError(`${name} : quantité trop grande.`);
  return { qty: Math.round(q * 1000) / 1000, size };
};

/** Contrôle de toutes les lignes avant d'écrire quoi que ce soit : un site n'est pas créé à moitié pour une faute de frappe. */
function checkItems(items: OpeningItem[]) {
  if (items.length > 500) throw new BusinessRuleError("500 articles au plus par saisie.");
  const seen = new Set<string>();
  for (const it of items) {
    const name = (it.name ?? "").trim();
    if (!name && !it.productId) throw new BusinessRuleError("Nom de l'article obligatoire.");
    if (!(Number(it.unitCost) >= 0)) throw new BusinessRuleError(`${name || "Article"} : coût invalide.`);
    const { qty } = qtyOf(it, name || "Article");
    if (qty > 0 && !(Number(it.unitCost) > 0)) throw new BusinessRuleError(`${name || "Article"} : indiquez le coût, sinon le stock de départ n'a pas de valeur.`);
    if (it.expiryDate && isNaN(new Date(it.expiryDate).getTime())) throw new BusinessRuleError(`${name || "Article"} : date de péremption invalide.`);
    const key = `${(it.productId || name).toLowerCase()}|${it.level}`;
    if (seen.has(key)) throw new BusinessRuleError(`${name || "Article"} figure deux fois au même endroit : regroupez les lignes.`);
    seen.add(key);
  }
}

/**
 * Ouverture d'un site en une fois : secteur analytique propre, caisse propre,
 * comptoir et réserve, argent alloué (écrit en comptabilité), agents datés,
 * accès des comptes, charges prévues par rubrique, fiches techniques reprises,
 * articles et stock de départ. Tout est contrôlé avant d'écrire. Si le stock
 * échoue malgré tout, le site reste ouvert et l'erreur est rendue : le stock
 * s'ajoute ensuite sur le site, sans repartir de zéro.
 */
export async function openSite(auth: TokenPayload, i: OpeningInput, canManageUsers: boolean) {
  const name = String(i.name ?? "").trim().slice(0, 120);
  if (!name) throw new BusinessRuleError("Nom du site obligatoire.");
  if (await ActivityDeskModel.exists({ tenantId: auth.tenantId, name })) throw new BusinessRuleError("Un site porte déjà ce nom.");
  const date = i.openingDate && /^\d{4}-\d{2}-\d{2}$/.test(i.openingDate) ? new Date(`${i.openingDate}T07:00:00`) : new Date();
  if (isNaN(date.getTime()) || date.getTime() > Date.now() + 366 * 86_400_000) throw new BusinessRuleError("Date d'ouverture invalide.");
  const vat = Number(i.vatRate ?? 0);
  if (!(vat >= 0 && vat <= 0.5)) throw new BusinessRuleError("Taux de TVA invalide.");
  const target = i.targetNetMargin === undefined ? 0.2 : Number(i.targetNetMargin);
  if (!(target >= 0 && target <= 0.9)) throw new BusinessRuleError("Marge nette visée invalide.");
  const planned = (i.plannedCosts ?? []).filter(p => p.category in CHARGE_CATEGORIES && Number(p.amount) > 0).map(p => ({ category: p.category, amount: Math.round(Number(p.amount)) }));
  const share = i.commonCostShare === undefined ? undefined : Number(i.commonCostShare);
  if (share !== undefined && !(share >= 0 && share <= 1)) throw new BusinessRuleError("Quote-part des charges communes invalide.");
  if (i.userIds?.length && !canManageUsers) throw new BusinessRuleError("L'accès des comptes au site revient à qui gère les utilisateurs.");
  const amount = Math.round(Number(i.funding?.amount ?? 0));
  if (!Number.isFinite(amount) || amount < 0) throw new BusinessRuleError("Montant de départ invalide.");
  if (amount > 0 && !(i.funding!.nature in FUNDING_NATURES)) throw new BusinessRuleError("Précisez l'origine du montant de départ.");
  if (amount > 0 && i.funding!.nature === "transfer" && !i.funding!.fromAccountId) throw new BusinessRuleError("Choisissez le compte qui verse le montant de départ.");
  const items = i.items ?? [];
  checkItems(items);

  // 1. Secteur, caisse, comptoir et argent de départ : tout ou rien.
  const desk = await withTransaction(async session => {
    const [sector] = await ActivityModel.create([{ tenantId: auth.tenantId, name, createdBy: auth.userId }], { session });
    const label = (i.cash?.label || `Caisse ${name}`).slice(0, 120);
    const ledgerCode = await nextLedgerCode(auth.tenantId, "cash", session);
    const [caisse] = await TreasuryAccountModel.create([{ tenantId: auth.tenantId, label, type: "cash", currency: "XOF", openingBalance: 0, openingDate: date, ledgerCode }], { session });
    await registerLedgerAccount(auth.tenantId, ledgerCode, label, session);
    const [d] = await ActivityDeskModel.create([{
      tenantId: auth.tenantId, name, activityId: sector._id, treasuryAccountId: caisse._id, vatRate: vat, targetNetMargin: target, openingDate: date, strictStock: true,
      ...(i.revenueAccount && /^7\d{2,7}$/.test(i.revenueAccount) ? { revenueAccount: i.revenueAccount } : {}),
      ...(planned.length ? { plannedCosts: planned } : {}), ...(share !== undefined ? { commonCostShare: share } : {}), createdBy: auth.userId,
    }], { session });
    if (amount > 0) await allocateFunds(auth, String(d._id), { ...i.funding!, amount, date: date.getTime() > Date.now() ? new Date() : date }, session);
    return d;
  });
  const deskId = String(desk._id);
  await Promise.all([deskWarehouse(auth.tenantId, desk._id), deskReserve(auth.tenantId, deskId)]);

  // 2. Agents (à partir de la date d'ouverture) et accès des comptes.
  if (i.staff?.length) {
    const staff = await validateStaff(auth.tenantId, deskId, i.staff.map(s => ({ ...s, from: localDay(date) })));
    await ActivityDeskModel.updateOne({ _id: desk._id }, { $set: { staff } });
  }
  if (i.userIds?.length) {
    const ids = i.userIds.filter(u => /^[a-f0-9]{24}$/i.test(u));
    await UserModel.updateMany({ _id: { $in: ids }, tenantId: auth.tenantId }, { $addToSet: { siteIds: desk._id } });
  }

  // 3. Articles, stock de départ, puis fiches techniques.
  let stock: Awaited<ReturnType<typeof openingStock>> | null = null, stockError: string | null = null;
  try { stock = await openingStock(auth, deskId, items, date.getTime() > Date.now() ? new Date() : date); }
  catch (e) { if (!(e instanceof BusinessRuleError)) throw e; stockError = e.message; }
  const copied = i.copyFromDeskId ? await copyRecipes(auth, i.copyFromDeskId, deskId) : null;
  return { deskId, name, items: stock?.items ?? 0, stockValue: stock?.stockValue ?? 0, funded: amount, copied, stockError };
}

/** Article du catalogue commun pour un nom : la même fiche d'un site à l'autre, pour consolider stocks et achats. */
async function catalogMatch(tenantId: string, name: string) {
  return ProductModel.findOne({ tenantId, label: new RegExp(`^${esc(name)}$`, "i") }).sort({ createdAt: 1 }).select("label unit category").lean<{ _id: Id; label: string; unit?: string; category?: string } | null>();
}

/**
 * Stock de départ d'un site : chaque article (fiche du catalogue reprise si
 * elle existe, sinon créée) entre au coût indiqué, en réserve ou au comptoir,
 * par une entrée tracée « Stock d'ouverture » : ni achat, ni dette, ni
 * résultat. Un inventaire d'ouverture validé en garde la liste.
 */
export async function openingStock(auth: TokenPayload, deskId: string, items: OpeningItem[], date = new Date()) {
  checkItems(items);
  if (!(await ActivityDeskModel.exists({ _id: deskId, tenantId: auth.tenantId, archived: { $ne: true } }))) throw new BusinessRuleError("Site introuvable.");
  const day = localDay(date);
  const byLevel: Record<"desk" | "reserve", Array<{ itemId: Id; name: string; unit: string; counted: number; unitCost: number }>> = { desk: [], reserve: [] };
  let value = 0;
  for (const it of items) {
    const cost = Number(it.unitCost);
    const typed = (it.name ?? "").trim().slice(0, 160);
    const product = it.productId
      ? await ProductModel.findOne({ _id: it.productId, tenantId: auth.tenantId }).select("label unit category").lean<{ _id: Id; label: string; unit?: string; category?: string } | null>()
      : await catalogMatch(auth.tenantId, typed);
    if (it.productId && !product) throw new BusinessRuleError("Article du catalogue introuvable.");
    const name = (product?.label ?? typed).slice(0, 160);
    const unit = (product?.unit || it.unit || "unité").slice(0, 24);
    const { qty, size } = qtyOf(it, name);
    // Article du site : repris s'il existe déjà (même fiche ou même nom), sinon créé.
    let item = await ActivityItemModel.findOne({ tenantId: auth.tenantId, deskId, archived: { $ne: true }, ...(product ? { productId: product._id } : { name }) }).select("_id").lean<{ _id: Id } | null>();
    if (!item) {
      const [c] = await ActivityItemModel.create([{
        tenantId: auth.tenantId, deskId, name, unit, quantity: 0, unitCost: cost,
        ...(product ? { productId: product._id } : {}), ...((it.category || product?.category) ? { category: (it.category || product?.category)!.slice(0, 60) } : {}),
        ...(Number(it.salePrice) > 0 ? { salePrice: Math.round(Number(it.salePrice)) } : {}), ...(size ? { pack: { label: (it.pack?.label || "carton").slice(0, 30), size } } : {}),
        ...(Number(it.threshold) > 0 ? { threshold: Number(it.threshold) } : {}), ...(it.rhythm && it.rhythm in RHYTHMS ? { rhythm: it.rhythm } : {}),
        createdBy: auth.userId,
      }]);
      item = { _id: c._id as Id };
    }
    const itemId = item._id;
    await withTransaction(async session => {
      const productId = await ensureLinked(auth, deskId, itemId, session);
      if (!(qty > 0)) return;
      const wh = it.level === "desk" ? await deskWarehouse(auth.tenantId, deskId, session) : await deskReserve(auth.tenantId, deskId, session);
      const r = await applyMovement({
        tenantId: auth.tenantId, userId: auth.userId, productId, warehouseId: wh, type: "entry", quantity: qty, unitCost: cost,
        ...(it.lotNumber || it.expiryDate ? { lots: [{ lotNumber: (it.lotNumber || `OUV-${day}`).slice(0, 80), qty, ...(it.expiryDate ? { expiryDate: it.expiryDate } : {}) }] } : { autoLot: `OUV-${day}` }),
        reason: `Stock d'ouverture du ${day}`, linkedDocType: "inventory", linkedDocId: new Types.ObjectId(deskId), linkedDocNumber: `OUV-${day}`,
      }, session);
      if (it.level === "desk") await ActivityStockMoveModel.create([{ tenantId: auth.tenantId, deskId, itemId, type: "in", quantity: qty, quantityAfter: r.after, unitCost: cost, reason: `Stock d'ouverture du ${day}`, stockMovementId: r.movement._id, date, createdBy: auth.userId }], { session });
    });
    if (!(qty > 0)) continue;
    byLevel[it.level === "desk" ? "desk" : "reserve"].push({ itemId, name, unit, counted: qty, unitCost: cost });
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
      gapValue, startedBy: auth.userId, validatedBy: auth.userId, validatedAt: date, note: "Stock de départ saisi à l'ouverture du site",
    });
  }
  // Comptages du comptoir, comme un inventaire d'ouverture validé : le résultat les retranche (stock initial, pas un gain).
  if (byLevel.desk.length) await ItemCountModel.insertMany(byLevel.desk.map(l => ({ tenantId: auth.tenantId, deskId, itemId: l.itemId, day, expected: 0, counted: l.counted, gap: l.counted, gapValue: Math.round(l.counted * l.unitCost), countedBy: auth.userId })));
  await syncLinkedItems(auth.tenantId, deskId);
  return { items: items.length, stockValue: Math.round(value), desk: byLevel.desk.length, reserve: byLevel.reserve.length };
}

interface SourceItem { _id: Id; name: string; unit: string; category?: string; salePrice?: number; unitCost?: number; productId?: Id; pack?: { label?: string; size?: number; cost?: number }; threshold?: number; reserveThreshold?: number; rhythm?: string; recipe?: Array<{ itemId: Id; quantity: number; yield?: number }>; portions?: number; allergens?: string[]; procedure?: string; targetMarkup?: number }

/** Articles d'un autre site (même archivé), prêts à reprendre dans une ouverture : fiche, prix, carton, coût du catalogue. */
export async function siteTemplates(tenantId: string, fromDeskId: string) {
  const items = await ActivityItemModel.find({ tenantId, deskId: fromDeskId, $or: [{ recipe: { $exists: false } }, { recipe: { $size: 0 } }] }).select("name unit category salePrice unitCost productId pack threshold rhythm").sort({ category: 1, name: 1 }).limit(500).lean<SourceItem[]>();
  const costs = new Map((await ProductModel.find({ tenantId, _id: { $in: items.map(i => i.productId).filter(Boolean) } }).select("purchaseCost").lean<Array<{ _id: Id; purchaseCost?: number }>>()).map(p => [String(p._id), p.purchaseCost ?? 0]));
  return items.map(i => ({ productId: i.productId ? String(i.productId) : undefined, name: i.name, unit: i.unit, category: i.category ?? "", salePrice: i.salePrice ?? null, unitCost: (i.productId && costs.get(String(i.productId))) || i.unitCost || 0, packSize: i.pack?.size ?? null, threshold: i.threshold ?? null, rhythm: i.rhythm ?? "" }));
}

/**
 * Reprend les fiches techniques d'un site : préparations, quantités,
 * rendement, portions, prix. Chaque ingrédient est relié à l'article du site
 * de même fiche ou de même nom, créé sans stock s'il manque.
 */
export async function copyRecipes(auth: TokenPayload, fromDeskId: string, toDeskId: string) {
  if (fromDeskId === toDeskId) return { recipes: 0, ingredients: 0 };
  const source = await ActivityItemModel.find({ tenantId: auth.tenantId, deskId: fromDeskId }).lean<SourceItem[]>();
  const byId = new Map(source.map(i => [String(i._id), i]));
  const target = await ActivityItemModel.find({ tenantId: auth.tenantId, deskId: toDeskId, archived: { $ne: true } }).select("name productId").lean<Array<{ _id: Id; name: string; productId?: Id }>>();
  let recipes = 0, ingredients = 0;
  const ensure = async (s: SourceItem): Promise<Id> => {
    const hit = target.find(t => (s.productId && String(t.productId) === String(s.productId)) || t.name.toLowerCase() === s.name.toLowerCase());
    if (hit) return hit._id;
    const [c] = await ActivityItemModel.create([{ tenantId: auth.tenantId, deskId: toDeskId, name: s.name, unit: s.unit, quantity: 0, unitCost: s.unitCost ?? 0, ...(s.productId ? { productId: s.productId } : {}), ...(s.category ? { category: s.category } : {}), ...(s.pack?.size ? { pack: s.pack } : {}), ...(s.salePrice ? { salePrice: s.salePrice } : {}), ...(s.rhythm ? { rhythm: s.rhythm } : {}), createdBy: auth.userId }]);
    target.push({ _id: c._id as Id, name: s.name, productId: s.productId });
    ingredients++;
    return c._id as Id;
  };
  for (const s of source.filter(x => x.recipe?.length)) {
    if (target.some(t => t.name.toLowerCase() === s.name.toLowerCase())) continue;
    const recipe: Array<{ itemId: Id; quantity: number; yield?: number }> = [];
    for (const r of s.recipe!) {
      const ing = byId.get(String(r.itemId));
      if (ing) recipe.push({ itemId: await ensure(ing), quantity: r.quantity, ...(r.yield ? { yield: r.yield } : {}) });
    }
    if (!recipe.length) continue;
    const [c] = await ActivityItemModel.create([{ tenantId: auth.tenantId, deskId: toDeskId, name: s.name, unit: s.unit, quantity: 0, unitCost: 0, recipe, ...(s.portions ? { portions: s.portions } : {}), ...(s.category ? { category: s.category } : {}), ...(s.salePrice ? { salePrice: s.salePrice } : {}), ...(s.targetMarkup ? { targetMarkup: s.targetMarkup } : {}), ...(s.allergens?.length ? { allergens: s.allergens } : {}), ...(s.procedure ? { procedure: s.procedure } : {}), createdBy: auth.userId }]);
    target.push({ _id: c._id as Id, name: s.name });
    recipes++;
  }
  return { recipes, ingredients };
}
