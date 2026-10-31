import { Types, type ClientSession } from "mongoose";
import { withTransaction } from "@/lib/db";
import { DeskInventoryModel } from "@/models/DeskInventory";
import { ActivityItemModel } from "@/models/ActivityItem";
import { ActivityStockMoveModel } from "@/models/ActivityStockMove";
import { ItemCountModel } from "@/models/ItemCount";
import { ProductStockModel } from "@/models/ProductStock";
import { ProductModel } from "@/models/Product";
import { BusinessRuleError } from "@/lib/errors";
import { applyMovement } from "@/lib/stock";
import { localDay } from "@/lib/format";
import { assertMonthOpen } from "@/lib/comptoir-sale";
import { deskWarehouse, syncLinkedItems } from "@/lib/comptoir-stock";
import { deskReserve, ensureLinked, restaurantStock } from "@/lib/restaurant-stock";
import type { TokenPayload } from "@/lib/auth";

type Id = Types.ObjectId;
type Level = "desk" | "reserve";
type Line = { itemId: Id; name: string; packSize?: number; parts?: Array<{ device: string; qty: number; at: Date; by: Id }>; counted?: number; countedAt?: Date; countedBy?: Id; expectedAtCount?: number; expected?: number; gap?: number; unitCost?: number; gapValue?: number };

/** Stock théorique d'un article à un niveau, lu dans la gestion de stock (jamais dans une copie). */
async function theoretical(tenantId: string, deskId: string, level: Level, itemId: Id, session?: ClientSession): Promise<number> {
  const it = await ActivityItemModel.findOne({ _id: itemId, tenantId, deskId }).select("productId quantity").session(session ?? null).lean<{ productId?: Id; quantity: number } | null>();
  if (!it) return 0;
  if (!it.productId) return level === "desk" ? Math.max(0, it.quantity || 0) : 0;
  const wh = level === "desk" ? await deskWarehouse(tenantId, deskId, session) : await deskReserve(tenantId, deskId, session);
  const row = await ProductStockModel.findOne({ tenantId, warehouseId: wh, productId: it.productId }).select("qty").session(session ?? null).lean<{ qty: number } | null>();
  return Math.max(0, row?.qty ?? 0);
}

/** Ouvre un inventaire (comptoir ou réserve) : un seul ouvert par niveau. Les préparations (recettes) ne se comptent pas. */
export async function openInventory(auth: TokenPayload, deskId: string, level: Level, category?: string, opening = false) {
  const { rows } = await restaurantStock(auth.tenantId, deskId, false);
  const lines = rows.filter(r => !r.preparation && (!category || r.category === category) && (level === "desk" || r.linked || r.reserve > 0))
    .map(r => ({ itemId: new Types.ObjectId(r.itemId), name: r.name, unit: r.unit, ...(r.barcode ? { barcode: r.barcode } : {}), ...(r.pack?.size ? { packSize: r.pack.size } : {}) }));
  if (!lines.length) throw new BusinessRuleError("Aucun article à compter.");
  const d = new Date(), p = (n: number) => String(n).padStart(2, "0");
  const number = `INV-${localDay(d).replace(/-/g, "")}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${level === "desk" ? "C" : "R"}`;
  try {
    return await DeskInventoryModel.create({ tenantId: auth.tenantId, deskId, number, level, ...(category ? { category } : {}), ...(opening ? { opening: true } : {}), lines, startedBy: auth.userId });
  } catch (e) {
    if ((e as { code?: number })?.code === 11000) throw new BusinessRuleError(`Un inventaire ${level === "desk" ? "du comptoir" : "de la réserve"} est déjà ouvert : terminez-le ou annulez-le.`);
    throw e;
  }
}

/**
 * Comptages reçus d'un appareil (scanner, saisie, file hors ligne rejouée) :
 * le sous-total de CET appareil pour chaque article (le dernier envoi de
 * l'appareil fait foi) ; le compté est la somme des appareils. Le stock
 * théorique est relevé au premier comptage de l'article. Une ligne invalide
 * est écartée sans bloquer les autres.
 */
export async function saveCounts(auth: TokenPayload, id: string, device: string, counts: Array<{ itemId: string; counted: number }>) {
  const dev = String(device || "web").slice(0, 64);
  for (let attempt = 0; ; attempt++) {
    const inv = await DeskInventoryModel.findOne({ _id: id, tenantId: auth.tenantId });
    if (!inv) throw new BusinessRuleError("Inventaire introuvable.");
    if (inv.status !== "open") throw new BusinessRuleError("Inventaire clos : comptages refusés.");
    let saved = 0, rejected = 0;
    for (const c of counts) {
      const q = Number(c.counted);
      const line = (inv.lines as Line[]).find(l => String(l.itemId) === String(c.itemId));
      if (!line || !(q >= 0) || q > 1e6) { rejected++; continue; }
      const parts = line.parts ?? [];
      const mine = parts.find(x => x.device === dev);
      const qty = Math.round(q * 1000) / 1000;
      if (mine) { mine.qty = qty; mine.at = new Date(); mine.by = new Types.ObjectId(auth.userId); }
      else parts.push({ device: dev, qty, at: new Date(), by: new Types.ObjectId(auth.userId) });
      line.parts = parts;
      line.counted = Math.round(parts.reduce((t, x) => t + x.qty, 0) * 1000) / 1000;
      line.countedAt = new Date(); line.countedBy = new Types.ObjectId(auth.userId);
      if (line.expectedAtCount == null) line.expectedAtCount = await theoretical(auth.tenantId, String(inv.deskId), inv.level, line.itemId);
      saved++;
    }
    inv.markModified("lines");
    try {
      await inv.save();
      return { saved, rejected, counted: (inv.lines as Line[]).filter(l => l.counted != null).length, total: inv.lines.length };
    } catch (e) {
      // Deux appareils enregistrent en même temps : on relit et on rejoue.
      if ((e as { name?: string })?.name === "VersionError" && attempt < 4) continue;
      throw e;
    }
  }
}

/**
 * Validation, d'un seul tenant (transaction) : l'inventaire est revendiqué,
 * chaque écart = compté − théorique relevé au comptage est passé en stock
 * en différence (perte ou reprise ; un excédent d'article suivi par lot entre
 * dans un lot « INV-… »), chiffré au coût. Les articles non comptés ne
 * bougent pas. Possible après l'arrêté de caisse du jour (on compte comptoir
 * fermé) ; refusée dans un mois de gestion clos.
 */
export async function validateInventory(auth: TokenPayload, id: string) {
  const pre = await DeskInventoryModel.findOne({ _id: id, tenantId: auth.tenantId }).select("deskId level lines.itemId lines.counted").lean<{ deskId: Id; level: Level; lines: Line[] } | null>();
  if (!pre) throw new BusinessRuleError("Inventaire introuvable.");
  const deskId = String(pre.deskId);
  if (pre.level === "reserve") for (const l of pre.lines.filter(x => x.counted != null)) await withTransaction(s => ensureLinked(auth, deskId, l.itemId, s));
  const out = await withTransaction(async session => {
    await assertMonthOpen(auth.tenantId, deskId, new Date(), session);
    const inv = await DeskInventoryModel.findOneAndUpdate({ _id: id, tenantId: auth.tenantId, status: "open" },
      { $set: { status: "validated", validatedBy: auth.userId, validatedAt: new Date() } }, { new: true, session }).lean<{ _id: Id; number: string; level: Level; lines: Line[] } | null>();
    if (!inv) throw new BusinessRuleError("Inventaire déjà validé ou annulé.");
    const counted = inv.lines.filter(l => l.counted != null);
    if (!counted.length) throw new BusinessRuleError("Aucun article compté.");
    const reason = `Inventaire ${inv.number}`, day = localDay(new Date());
    const wh = inv.level === "desk" ? await deskWarehouse(auth.tenantId, deskId, session) : await deskReserve(auth.tenantId, deskId, session);
    for (const l of counted) {
      const item = await ActivityItemModel.findOne({ _id: l.itemId, tenantId: auth.tenantId, deskId }).session(session ?? null);
      if (!item) continue;
      const expected = l.expectedAtCount ?? await theoretical(auth.tenantId, deskId, inv.level, l.itemId, session);
      const gap = Math.round((l.counted! - expected) * 1000) / 1000;
      let unitCost = item.unitCost || 0, stockMovementId: unknown;
      if (item.productId) {
        const p = await ProductModel.findOne({ _id: item.productId, tenantId: auth.tenantId }).select("purchaseCost").session(session ?? null).lean<{ purchaseCost?: number } | null>();
        unitCost = p?.purchaseCost || unitCost;
        if (gap !== 0) {
          const r = await applyMovement({ tenantId: auth.tenantId, userId: auth.userId, productId: item.productId, warehouseId: wh, type: gap < 0 ? "loss" : "return", quantity: Math.abs(gap), allowPartial: true, autoLot: `INV-${inv.number}`, reason, linkedDocType: "inventory", linkedDocId: inv._id, linkedDocNumber: inv.number }, session);
          unitCost = Number(r.movement.unitCost) || unitCost; stockMovementId = r.movement._id;
        }
      } else if (inv.level === "desk" && gap !== 0) {
        item.quantity = Math.max(0, Math.round(((item.quantity || 0) + gap) * 1000) / 1000);
        await item.save({ session });
      }
      // Même arrondi que la valeur de perte (au franc, symétrique) : le rapport des pertes et l'écart concordent.
      const gapValue = gap < 0 ? -Math.round(-gap * unitCost) : Math.round(gap * unitCost);
      l.expected = expected; l.gap = gap; l.unitCost = unitCost; l.gapValue = gapValue;
      if (inv.level === "desk") {
        if (gap !== 0) await ActivityStockMoveModel.create([{ tenantId: auth.tenantId, deskId, itemId: item._id, type: "adjust", quantity: Math.abs(gap), quantityAfter: item.productId ? await theoretical(auth.tenantId, deskId, "desk", item._id, session) : item.quantity, unitCost, reason, stockMovementId,
          ...(gap < 0 ? { lossReason: "inventory", lossValue: Math.round(-gap * unitCost) } : {}), date: new Date(), createdBy: auth.userId }], { session });
        // Historique des comptages (inventaire tournant, résultat du mois).
        await ItemCountModel.create([{ tenantId: auth.tenantId, deskId, itemId: item._id, day, expected, counted: l.counted, gap, gapValue, countedBy: auth.userId }], { session });
      }
    }
    const gapValue = counted.reduce((t, l) => t + (l.gapValue ?? 0), 0);
    await DeskInventoryModel.updateOne({ _id: inv._id }, { $set: { lines: inv.lines, gapValue } }, { session });
    return { ...inv, gapValue, status: "validated" as const };
  });
  await syncLinkedItems(auth.tenantId, deskId);
  return out;
}

/** Annulation d'un inventaire encore ouvert (le stock ne bouge pas). */
export async function cancelInventory(auth: TokenPayload, id: string, canManage: boolean) {
  // Annuler fait perdre les comptages de tous les appareils : le chef (ou la finance), ou celui qui a ouvert l'inventaire.
  const r = await DeskInventoryModel.updateOne({ _id: id, tenantId: auth.tenantId, status: "open", ...(canManage ? {} : { startedBy: auth.userId }) }, { $set: { status: "cancelled" } });
  if (r.modifiedCount !== 1) throw new BusinessRuleError(canManage ? "Inventaire déjà validé ou annulé." : "Seuls le chef du comptoir et la personne qui l'a ouvert annulent un inventaire (ou il est déjà clos).");
}
