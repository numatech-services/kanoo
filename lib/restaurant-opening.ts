import { Types, type ClientSession } from "mongoose";
import { withTransaction } from "@/lib/db";
import { ActivityModel } from "@/models/Activity";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { ActivityItemModel } from "@/models/ActivityItem";
import { ActivityStockMoveModel } from "@/models/ActivityStockMove";
import { ApiKeyModel } from "@/models/ApiKey";
import { PurchaseModel } from "@/models/Purchase";
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
import { WarehouseModel } from "@/models/Warehouse";
import { BusinessRuleError } from "@/lib/errors";
import { applyMovement } from "@/lib/stock";
import { assertMonthOpen } from "@/lib/comptoir-sale";
import { deskWarehouse, syncLinkedItems } from "@/lib/comptoir-stock";
import { deskReserve, ensureLinked } from "@/lib/restaurant-stock";
import { validateStaff } from "@/lib/restaurant-team";
import { accountBalance, nextLedgerCode, registerLedgerAccount } from "@/lib/treasury";
import { addOpeningLine, allocateFunds, openingPosition, transferFunds, type FundingNature, FUNDING_NATURES, OPENING_KINDS } from "@/lib/restaurant-funding";
import { CHARGE_CATEGORIES, RHYTHMS, sameName } from "@/lib/restaurant";
import { localDay } from "@/lib/format";
import type { TokenPayload } from "@/lib/auth";

type Id = Types.ObjectId;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
interface DeskRow { _id: Id; name: string; warehouseId?: Id; reserveWarehouseId?: Id; treasuryAccountId?: Id; staff?: unknown[]; plannedCosts?: unknown[]; openingDate?: Date; openingValidatedAt?: Date; vatRate?: number; activityId?: Id }

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
  const desks = await ActivityDeskModel.find({ tenantId, archived: { $ne: true } }).select("name warehouseId reserveWarehouseId treasuryAccountId staff plannedCosts openingDate openingValidatedAt vatRate").sort({ name: 1 }).lean<DeskRow[]>();
  return Promise.all(desks.map(async d => {
    const [stock, items, noPrice, openInventories, session, funding, pending, balance, deskRows, debts, advances, keys] = await Promise.all([
      stockOf(tenantId, d),
      ActivityItemModel.countDocuments({ tenantId, deskId: d._id, archived: { $ne: true } }),
      ActivityItemModel.countDocuments({ tenantId, deskId: d._id, archived: { $ne: true }, $or: [{ salePrice: { $exists: false } }, { salePrice: null }, { salePrice: 0 }] }),
      DeskInventoryModel.countDocuments({ tenantId, deskId: d._id, status: "open" }),
      CashSessionModel.exists({ tenantId, deskId: d._id, status: "open" }),
      DeskFundingModel.find({ tenantId, deskId: d._id, kind: "money", cancelledAt: { $exists: false } }).select("amount").lean<Array<{ amount: number }>>(),
      DeskTransferModel.countDocuments({ tenantId, status: { $in: ["sent", "transit", "gap"] }, $or: [{ fromDeskId: d._id }, { toDeskId: d._id }] }),
      d.treasuryAccountId ? accountBalance(tenantId, String(d.treasuryAccountId)) : Promise.resolve(null),
      d.warehouseId ? ProductStockModel.countDocuments({ tenantId, warehouseId: d.warehouseId, qty: { $gt: 0 } }) : Promise.resolve(0),
      PurchaseModel.find({ tenantId, deskId: d._id, status: { $in: ["validated", "partial"] } }).select("totalTTC paidAmount").lean<Array<{ totalTTC: number; paidAmount?: number }>>(),
      DeskFundingModel.find({ tenantId, deskId: d._id, repayable: true, cancelledAt: { $exists: false } }).select("amount repaid").lean<Array<{ amount: number; repaid?: number }>>(),
      ApiKeyModel.countDocuments({ tenantId, deskId: d._id, isActive: true }),
    ]);
    const funded = funding.reduce((t, f) => t + f.amount, 0);
    return {
      deskId: String(d._id), name: d.name, openingDate: d.openingDate ?? null, items, openInventories, stockLines: stock.lines, stockValue: stock.value, negatives: stock.negatives, deskStockLines: deskRows, noPrice,
      hasCash: !!d.treasuryAccountId, cashBalance: balance?.balance ?? null, funded, staff: (d.staff ?? []).length, planned: (d.plannedCosts ?? []).length,
      sessionOpen: !!session, pendingTransfers: pending, openDebts: debts.reduce((t, p) => t + p.totalTTC - (p.paidAmount ?? 0), 0), advancesLeft: advances.reduce((t, f) => t + f.amount - (f.repaid ?? 0), 0), easypayKeys: keys,
      validated: !!d.openingValidatedAt, vatRate: d.vatRate ?? 0,
      todo: [...(!d.treasuryAccountId ? ["caisse"] : !funded && !(balance?.balance) ? ["montant de départ"] : []), ...(!stock.lines ? ["stock de départ"] : stock.lines && !deskRows ? ["monter du stock au comptoir"] : []), ...(items && noPrice ? [`${noPrice} prix de vente`] : []), ...(!(d.staff ?? []).length ? ["agents"] : []), ...(!(d.plannedCosts ?? []).length ? ["charges prévues"] : [])],
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
    const d = await ActivityDeskModel.findOne({ _id: id, tenantId: auth.tenantId, archived: { $ne: true } }).select("name warehouseId reserveWarehouseId treasuryAccountId activityId").lean<DeskRow | null>();
    if (!d) throw new BusinessRuleError("Site introuvable ou déjà archivé.");
    if (await CashSessionModel.exists({ tenantId: auth.tenantId, deskId: d._id, status: "open" })) throw new BusinessRuleError(`${d.name} : fermez d'abord sa caisse.`);
    if (await DeskTransferModel.exists({ tenantId: auth.tenantId, status: { $in: ["sent", "transit", "gap"] }, $or: [{ fromDeskId: d._id }, { toDeskId: d._id }] })) throw new BusinessRuleError(`${d.name} : un transfert attend d'être reçu ou tranché.`);
    if (await ApiKeyModel.exists({ tenantId: auth.tenantId, deskId: d._id, isActive: true })) throw new BusinessRuleError(`${d.name} : révoquez d'abord sa clé EasyPay, sinon la caisse continuera de lui envoyer des ventes.`);
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
      // Le nom d'archive reste unique, même pour deux sites homonymes archivés le même jour ; le secteur suit, s'il n'a plus de site actif.
      const suffix = ` (archivé ${day} ${String(d._id).slice(-4)})`;
      if (d.activityId && !(await ActivityDeskModel.exists({ tenantId: auth.tenantId, activityId: d.activityId, archived: { $ne: true }, _id: { $ne: d._id } }).session(session ?? null))) {
        const sector = await ActivityModel.findOne({ _id: d.activityId, tenantId: auth.tenantId }).select("name").session(session ?? null).lean<{ name: string } | null>();
        if (sector) await ActivityModel.updateOne({ _id: d.activityId, tenantId: auth.tenantId }, { $set: { archived: true, name: `${sector.name.slice(0, 120 - suffix.length)}${suffix}` } }, { session });
      }
      await DeskInventoryModel.updateMany({ tenantId: auth.tenantId, deskId: d._id, status: "open" }, { $set: { status: "cancelled", note: `Annulé : nouveau départ du ${day}` } }, { session });
      await ActivityItemModel.updateMany({ tenantId: auth.tenantId, deskId: d._id, archived: { $ne: true } }, { $set: { archived: true } }, { session });
      await ActivityDeskModel.updateOne({ _id: d._id, tenantId: auth.tenantId }, { $set: { archived: true, name: `${d.name.slice(0, 120 - suffix.length)}${suffix}` } }, { session });
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
  /** Qui a payé le stock de départ : il figure alors en ressource dans la situation de départ. */
  stockFundedBy?: "taken_over" | "owner_paid" | "debt";
  copyFromDeskId?: string;
}

/** Écart d'inventaire au-delà duquel la validation revient à la direction ou à la comptabilité. Hypothèse à valider, modifiable par site. */
export const DEFAULT_GAP_THRESHOLD = 50_000;

const qtyOf = (it: OpeningItem, name: string) => {
  const size = Number(it.pack?.size) >= 1 ? Number(it.pack!.size) : undefined;
  const packs = it.packs === undefined || it.packs === null ? 0 : Number(it.packs), units = it.quantity === undefined || it.quantity === null ? 0 : Number(it.quantity);
  if (packs < 0 || units < 0 || !Number.isFinite(packs) || !Number.isFinite(units)) throw new BusinessRuleError(`${name} : quantité invalide.`);
  if (packs > 0 && !size) throw new BusinessRuleError(`${name} : indiquez la taille du carton.`);
  const q = packs * (size ?? 0) + units;
  if (q > 1e7) throw new BusinessRuleError(`${name} : quantité trop grande.`);
  return { qty: Math.round(q * 1000) / 1000, size };
};

/** Contrôle de toutes les lignes avant d'écrire quoi que ce soit : un site n'est pas créé à moitié pour une faute de frappe. */
async function checkItems(tenantId: string, raw: unknown) {
  if (!Array.isArray(raw)) throw new BusinessRuleError("Liste d'articles invalide.");
  const items = raw as OpeningItem[];
  if (items.length > 500) throw new BusinessRuleError("500 articles au plus par saisie.");
  const seen = new Set<string>();
  for (const it of items) {
    if (!it || typeof it !== "object") throw new BusinessRuleError("Ligne d'article invalide.");
    const name = String(it.name ?? "").trim();
    if (!name && !it.productId) throw new BusinessRuleError("Nom de l'article obligatoire.");
    const cost = Number(it.unitCost);
    if (!(cost >= 0) || !Number.isFinite(cost) || cost > 1e9) throw new BusinessRuleError(`${name || "Article"} : coût invalide.`);
    const { qty } = qtyOf(it, name || "Article");
    if (qty > 0 && !(cost > 0)) throw new BusinessRuleError(`${name || "Article"} : indiquez le coût, sinon le stock de départ n'a pas de valeur.`);
    if (it.expiryDate && isNaN(new Date(it.expiryDate).getTime())) throw new BusinessRuleError(`${name || "Article"} : date de péremption invalide.`);
    const product = it.productId
      ? await ProductModel.findOne({ _id: Types.ObjectId.isValid(String(it.productId)) ? it.productId : null, tenantId }).select("label isService trackingMode").lean<{ _id: Id; label: string; isService?: boolean; trackingMode?: string } | null>()
      : await catalogMatch(tenantId, name);
    if (it.productId && !product) throw new BusinessRuleError("Article du catalogue introuvable.");
    if (product?.isService) throw new BusinessRuleError(`${product.label} est un service : il n'a pas de stock.`);
    if (product?.trackingMode === "serial" && qty > 0) throw new BusinessRuleError(`${product.label} est suivi par numéro de série : saisissez-le par une réception.`);
    const key = `${product ? String(product._id) : sameName(name)}|${it.level === "desk" ? "desk" : "reserve"}`;
    if (seen.has(key)) throw new BusinessRuleError(`${product?.label ?? name} figure deux fois au même endroit : regroupez les lignes.`);
    seen.add(key);
  }
  return items;
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
  if (!i || typeof i !== "object") throw new BusinessRuleError("Site invalide.");
  const name = String(i.name ?? "").trim().slice(0, 120);
  if (!name) throw new BusinessRuleError("Nom du site obligatoire.");
  if (await ActivityDeskModel.exists({ tenantId: auth.tenantId, name })) throw new BusinessRuleError("Un site porte déjà ce nom.");
  const date = i.openingDate && /^\d{4}-\d{2}-\d{2}$/.test(i.openingDate) ? new Date(`${i.openingDate}T07:00:00`) : new Date();
  if (isNaN(date.getTime()) || date.getTime() > Date.now() + 366 * 86_400_000) throw new BusinessRuleError("Date d'ouverture invalide.");
  const vat = Number(i.vatRate ?? 0);
  if (!(vat >= 0 && vat <= 0.5)) throw new BusinessRuleError("Taux de TVA invalide.");
  const target = i.targetNetMargin === undefined ? 0.2 : Number(i.targetNetMargin);
  if (!(target >= 0 && target <= 0.9)) throw new BusinessRuleError("Marge nette visée invalide.");
  const costs = Array.isArray(i.plannedCosts) ? i.plannedCosts : [];
  const planned = costs.filter(p => p && Object.hasOwn(CHARGE_CATEGORIES, p.category) && Number(p.amount) > 0 && Number(p.amount) < 1e11).map(p => ({ category: p.category, amount: Math.round(Number(p.amount)) }));
  const share = i.commonCostShare === undefined ? undefined : Number(i.commonCostShare);
  if (share !== undefined && !(share >= 0 && share <= 1)) throw new BusinessRuleError("Quote-part des charges communes invalide.");
  const userIds = Array.isArray(i.userIds) ? i.userIds : [];
  if (userIds.length && !canManageUsers) throw new BusinessRuleError("L'accès des comptes au site revient à qui gère les utilisateurs.");
  const amount = Math.round(Number(i.funding?.amount ?? 0));
  if (!Number.isFinite(amount) || amount < 0 || amount > 1e11) throw new BusinessRuleError("Montant de départ invalide.");
  if (amount > 0 && !Object.hasOwn(FUNDING_NATURES, i.funding!.nature)) throw new BusinessRuleError("Précisez l'origine du montant de départ.");
  if (amount > 0 && i.funding!.nature === "transfer" && !i.funding!.fromAccountId) throw new BusinessRuleError("Choisissez le compte qui verse le montant de départ.");
  const items = await checkItems(auth.tenantId, i.items ?? []);
  // Les agents se contrôlent ici : une affectation refusée ne doit pas laisser un site à moitié ouvert, argent écrit.
  const staffIn = Array.isArray(i.staff) ? i.staff : [];
  const staffPlan = staffIn.length ? await validateStaff(auth.tenantId, String(new Types.ObjectId()), staffIn.map(s => ({ ...s, from: localDay(date) }))) : [];
  if (i.copyFromDeskId && !(Types.ObjectId.isValid(i.copyFromDeskId) && await ActivityDeskModel.exists({ _id: i.copyFromDeskId, tenantId: auth.tenantId }))) throw new BusinessRuleError("Site à reprendre introuvable.");

  // 1. Secteur, caisse, comptoir et argent de départ : tout ou rien.
  const desk = await withTransaction(async session => {
    // Un secteur de ce nom sans site actif est repris ; pris par un autre site, un nom voisin évite le doublon.
    const same = await ActivityModel.findOne({ tenantId: auth.tenantId, name }).select("_id").session(session ?? null).lean<{ _id: Id } | null>();
    const free = same && !(await ActivityDeskModel.exists({ tenantId: auth.tenantId, activityId: same._id, archived: { $ne: true } }).session(session ?? null));
    const sector = free ? same : (await ActivityModel.create([{ tenantId: auth.tenantId, name: same ? `${name.slice(0, 110)} (site)` : name, createdBy: auth.userId }], { session }))[0];
    const label = (i.cash?.label || `Caisse ${name}`).slice(0, 120);
    const ledgerCode = await nextLedgerCode(auth.tenantId, "cash", session);
    const [caisse] = await TreasuryAccountModel.create([{ tenantId: auth.tenantId, label, type: "cash", currency: "XOF", openingBalance: 0, openingDate: date, ledgerCode }], { session });
    await registerLedgerAccount(auth.tenantId, ledgerCode, label, session);
    const [d] = await ActivityDeskModel.create([{
      tenantId: auth.tenantId, name, activityId: sector._id, treasuryAccountId: caisse._id, vatRate: vat, targetNetMargin: target, openingDate: date, strictStock: true, gapApprovalThreshold: DEFAULT_GAP_THRESHOLD,
      ...(i.revenueAccount && /^7\d{2,7}$/.test(i.revenueAccount) ? { revenueAccount: i.revenueAccount } : {}),
      ...(planned.length ? { plannedCosts: planned } : {}), ...(share !== undefined ? { commonCostShare: share } : {}), createdBy: auth.userId,
    }], { session });
    if (amount > 0) await allocateFunds(auth, String(d._id), { ...i.funding!, amount, date: date.getTime() > Date.now() ? new Date() : date }, session);
    return d;
  });
  const deskId = String(desk._id);
  await Promise.all([deskWarehouse(auth.tenantId, desk._id), deskReserve(auth.tenantId, deskId)]);

  // 2. Agents (déjà contrôlés) et accès des comptes.
  if (staffPlan.length) await ActivityDeskModel.updateOne({ _id: desk._id }, { $set: { staff: staffPlan } });
  if (userIds.length) await UserModel.updateMany({ _id: { $in: userIds.filter(u => /^[a-f0-9]{24}$/i.test(String(u))) }, tenantId: auth.tenantId }, { $addToSet: { siteIds: desk._id } });

  // 3. Articles, stock de départ, puis fiches techniques. Le stock est tout ou rien ; en échec, le site reste ouvert et le dit.
  let stock: Awaited<ReturnType<typeof openingStock>> | null = null, stockError: string | null = null;
  try { stock = await openingStock(auth, deskId, items, date.getTime() > Date.now() ? new Date() : date); }
  catch (e) { if (!(e instanceof BusinessRuleError)) throw e; stockError = e.message; }
  // Qui a payé ce stock : une ressource de la situation de départ, sans argent de plus.
  if (stock?.stockValue && i.stockFundedBy && Object.hasOwn(OPENING_KINDS, i.stockFundedBy)) await addOpeningLine(auth, deskId, { kind: i.stockFundedBy, amount: stock.stockValue, label: "Stock de départ", date: date.getTime() > Date.now() ? new Date() : date });
  const copied = i.copyFromDeskId ? await copyRecipes(auth, i.copyFromDeskId, deskId) : null;
  return { deskId, name, items: stock?.items ?? 0, stockValue: stock?.stockValue ?? 0, funded: amount, copied, stockError, deskLines: stock?.desk ?? 0, reserveLines: stock?.reserve ?? 0 };
}

/** Article du catalogue commun pour un nom : la même fiche d'un site à l'autre, pour consolider stocks et achats. */
async function catalogMatch(tenantId: string, name: string, session?: ClientSession) {
  return ProductModel.findOne({ tenantId, label: new RegExp(`^${esc(name)}$`, "i") }).sort({ createdAt: 1 }).select("label unit category isService trackingMode").session(session ?? null).lean<{ _id: Id; label: string; unit?: string; category?: string; isService?: boolean; trackingMode?: string } | null>();
}

/**
 * Stock de départ d'un site : chaque article (fiche du catalogue reprise si
 * elle existe, sinon créée) entre au coût indiqué, en réserve ou au comptoir,
 * par une entrée tracée « Stock d'ouverture » : ni achat, ni dette, ni
 * résultat. Un inventaire d'ouverture validé en garde la liste.
 */
export async function openingStock(auth: TokenPayload, deskId: string, raw: unknown, date = new Date()) {
  const items = await checkItems(auth.tenantId, raw);
  const day = localDay(date);
  type Row = { itemId: Id; name: string; unit: string; counted: number; unitCost: number };
  const result = await withTransaction(async session => {
    if (!(await ActivityDeskModel.exists({ _id: deskId, tenantId: auth.tenantId, archived: { $ne: true } }).session(session ?? null))) throw new BusinessRuleError("Site introuvable.");
    await assertMonthOpen(auth.tenantId, deskId, date, session);
    const byLevel: Record<"desk" | "reserve", Row[]> = { desk: [], reserve: [] };
    let value = 0;
    for (const it of items) {
      const cost = Number(it.unitCost), typed = String(it.name ?? "").trim().slice(0, 160);
      const product = it.productId
        ? await ProductModel.findOne({ _id: it.productId, tenantId: auth.tenantId }).select("label unit category").session(session ?? null).lean<{ _id: Id; label: string; unit?: string; category?: string } | null>()
        : await catalogMatch(auth.tenantId, typed, session);
      const name = (product?.label ?? typed).slice(0, 160);
      const unit = (product?.unit || it.unit || "unité").slice(0, 24);
      const { qty, size } = qtyOf(it, name);
      // Article du site : repris s'il existe déjà (même fiche ou même nom), sinon créé.
      let item = await ActivityItemModel.findOne({ tenantId: auth.tenantId, deskId, archived: { $ne: true }, ...(product ? { productId: product._id } : { name }) }).select("_id").session(session ?? null).lean<{ _id: Id } | null>();
      if (!item) {
        const [c] = await ActivityItemModel.create([{
          tenantId: auth.tenantId, deskId, name, unit, quantity: 0, unitCost: cost,
          ...(product ? { productId: product._id } : {}), ...((it.category || product?.category) ? { category: (it.category || product?.category)!.slice(0, 60) } : {}),
          ...(Number(it.salePrice) > 0 ? { salePrice: Math.round(Number(it.salePrice)) } : {}), ...(size ? { pack: { label: (it.pack?.label || "carton").slice(0, 30), size } } : {}),
          ...(Number(it.threshold) > 0 ? { threshold: Number(it.threshold) } : {}), ...(it.rhythm && Object.hasOwn(RHYTHMS, it.rhythm) ? { rhythm: it.rhythm } : {}),
          createdBy: auth.userId,
        }], { session });
        item = { _id: c._id as Id };
      }
      const itemId = item._id;
      const productId = await ensureLinked(auth, deskId, itemId, session);
      if (!(qty > 0)) continue;
      const wh = it.level === "desk" ? await deskWarehouse(auth.tenantId, deskId, session) : await deskReserve(auth.tenantId, deskId, session);
      const r = await applyMovement({
        tenantId: auth.tenantId, userId: auth.userId, productId, warehouseId: wh, type: "entry", quantity: qty, unitCost: cost,
        ...(it.lotNumber || it.expiryDate ? { lots: [{ lotNumber: (it.lotNumber || `OUV-${day}`).slice(0, 80), qty, ...(it.expiryDate ? { expiryDate: it.expiryDate } : {}) }] } : { autoLot: `OUV-${day}` }),
        reason: `Stock d'ouverture du ${day}`, linkedDocType: "inventory", linkedDocId: new Types.ObjectId(deskId), linkedDocNumber: `OUV-${day}`,
      }, session);
      if (it.level === "desk") await ActivityStockMoveModel.create([{ tenantId: auth.tenantId, deskId, itemId, type: "in", quantity: qty, quantityAfter: r.after, unitCost: cost, reason: `Stock d'ouverture du ${day}`, stockMovementId: r.movement._id, date, createdBy: auth.userId }], { session });
      byLevel[it.level === "desk" ? "desk" : "reserve"].push({ itemId, name, unit, counted: qty, unitCost: cost });
      value += qty * cost;
    }
    // Inventaires d'ouverture (déjà validés) : la liste comptée, hors résultat.
    for (const level of ["desk", "reserve"] as const) {
      const lines = byLevel[level];
      if (!lines.length) continue;
      const gapValue = lines.reduce((t, l) => t + Math.round(l.counted * l.unitCost), 0);
      await DeskInventoryModel.create([{
        tenantId: auth.tenantId, deskId, number: `OUV-${day.replace(/-/g, "")}-${level === "desk" ? "C" : "R"}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`, level, status: "validated", opening: true,
        lines: lines.map(l => ({ itemId: l.itemId, name: l.name, unit: l.unit, counted: l.counted, expected: 0, gap: l.counted, unitCost: l.unitCost, gapValue: Math.round(l.counted * l.unitCost), countedBy: auth.userId, countedAt: date })),
        gapValue, startedBy: auth.userId, validatedBy: auth.userId, validatedAt: date, note: "Stock de départ saisi à l'ouverture du site",
      }], { session });
    }
    // Comptages du comptoir, comme un inventaire d'ouverture validé : le résultat les retranche (stock initial, pas un gain).
    if (byLevel.desk.length) await ItemCountModel.create(byLevel.desk.map(l => ({ tenantId: auth.tenantId, deskId, itemId: l.itemId, day, expected: 0, counted: l.counted, gap: l.counted, gapValue: Math.round(l.counted * l.unitCost), countedBy: auth.userId, opening: true })), { session, ordered: true });
    return { items: items.length, stockValue: Math.round(value), desk: byLevel.desk.length, reserve: byLevel.reserve.length };
  });
  await syncLinkedItems(auth.tenantId, deskId);
  return result;
}

/** La comptable valide la situation de départ d'un site : plus d'origine à qualifier, ressources égales aux emplois. */
export async function validateOpening(auth: TokenPayload, deskId: string) {
  const inv = await DeskInventoryModel.find({ tenantId: auth.tenantId, deskId, opening: true, status: "validated" }).select("gapValue").lean<Array<{ gapValue?: number }>>();
  const pos = await openingPosition(auth.tenantId, deskId, inv.reduce((t, i) => t + (i.gapValue ?? 0), 0));
  if (pos.lines.some(l => l.toQualify)) throw new BusinessRuleError("Des lignes restent à qualifier.");
  if (pos.gap !== 0) throw new BusinessRuleError(`Ressources et emplois diffèrent de ${Math.abs(pos.gap).toLocaleString("fr-FR")} FCFA : complétez la situation.`);
  await ActivityDeskModel.updateOne({ _id: deskId, tenantId: auth.tenantId }, { $set: { openingValidatedAt: new Date(), openingValidatedBy: auth.userId } });
}

interface SourceItem { _id: Id; name: string; unit: string; category?: string; salePrice?: number; unitCost?: number; productId?: Id; pack?: { label?: string; size?: number; cost?: number }; threshold?: number; reserveThreshold?: number; rhythm?: string; recipe?: Array<{ itemId: Id; quantity: number; yield?: number }>; portions?: number; allergens?: string[]; procedure?: string; targetMarkup?: number; productionMode?: string }

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
    const [c] = await ActivityItemModel.create([{ tenantId: auth.tenantId, deskId: toDeskId, name: s.name, unit: s.unit, quantity: 0, unitCost: 0, recipe, ...(s.productionMode ? { productionMode: s.productionMode } : {}), ...(s.portions ? { portions: s.portions } : {}), ...(s.category ? { category: s.category } : {}), ...(s.salePrice ? { salePrice: s.salePrice } : {}), ...(s.targetMarkup ? { targetMarkup: s.targetMarkup } : {}), ...(s.allergens?.length ? { allergens: s.allergens } : {}), ...(s.procedure ? { procedure: s.procedure } : {}), createdBy: auth.userId }]);
    target.push({ _id: c._id as Id, name: s.name });
    recipes++;
  }
  return { recipes, ingredients };
}

/**
 * Stock de l'entreprise, article par article : chaque site actif, la
 * marchandise en transit (une seule fois), le total et sa valeur au coût.
 */
export async function consolidatedStock(tenantId: string) {
  const all = await ActivityDeskModel.find({ tenantId }).select("name archived warehouseId reserveWarehouseId").sort({ name: 1 }).lean<Array<DeskRow & { archived?: boolean }>>();
  const held = new Set((await ProductStockModel.find({ tenantId, qty: { $ne: 0 } }).select("warehouseId").lean<Array<{ warehouseId: Id }>>()).map(r => String(r.warehouseId)));
  // Un site archivé reste au consolidé tant qu'il garde du stock : rien ne disparaît sans trace.
  const desks = all.filter(d => !d.archived || [d.warehouseId, d.reserveWarehouseId].some(w => w && held.has(String(w))));
  const transit = await WarehouseModel.findOne({ tenantId, code: "TRANSIT" }).select("_id").lean<{ _id: Id } | null>();
  const whs = new Map<string, string>();
  for (const d of desks) for (const w of [d.warehouseId, d.reserveWarehouseId]) if (w) whs.set(String(w), String(d._id));
  const stock = await ProductStockModel.find({ tenantId, warehouseId: { $in: [...whs.keys(), ...(transit ? [String(transit._id)] : [])] }, qty: { $ne: 0 } }).select("productId warehouseId qty").lean<Array<{ productId: Id; warehouseId: Id; qty: number }>>();
  const products = new Map((await ProductModel.find({ tenantId, _id: { $in: stock.map(s => s.productId) } }).select("label unit purchaseCost").lean<Array<{ _id: Id; label: string; unit?: string; purchaseCost?: number }>>()).map(p => [String(p._id), p]));
  const byProduct = new Map<string, { productId: string; label: string; unit: string; sites: Record<string, number>; transit: number; total: number; value: number }>();
  for (const s of stock) {
    const p = products.get(String(s.productId));
    const row = byProduct.get(String(s.productId)) ?? { productId: String(s.productId), label: p?.label ?? "—", unit: p?.unit ?? "", sites: {}, transit: 0, total: 0, value: 0 };
    const site = whs.get(String(s.warehouseId));
    if (site) row.sites[site] = (row.sites[site] ?? 0) + s.qty; else row.transit += s.qty;
    row.total += s.qty; row.value = Math.round(row.total * (p?.purchaseCost ?? 0));
    byProduct.set(String(s.productId), row);
  }
  const rows = [...byProduct.values()].sort((a, b) => a.label.localeCompare(b.label));
  return { sites: desks.map(d => ({ _id: String(d._id), name: d.name })), rows, totalValue: rows.reduce((t, r) => t + r.value, 0) };
}
