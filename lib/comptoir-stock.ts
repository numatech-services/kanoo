import { Types, type ClientSession } from "mongoose";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { ActivityItemModel } from "@/models/ActivityItem";
import { WarehouseModel } from "@/models/Warehouse";
import { ProductStockModel } from "@/models/ProductStock";
import { ProductModel } from "@/models/Product";

/**
 * Réserve d'un comptoir dans la gestion de stock : un entrepôt « comptoir »
 * par site, créé à la demande. Les articles du comptoir reliés au catalogue
 * y ont leur stock — l'approvisionnement depuis le magasin est un transfert.
 */
export async function deskWarehouse(tenantId: string, deskId: unknown, session?: ClientSession): Promise<Types.ObjectId> {
  const desk = await ActivityDeskModel.findOne({ _id: deskId, tenantId }).select("name warehouseId").session(session ?? null)
    .lean<{ _id: Types.ObjectId; name: string; warehouseId?: Types.ObjectId } | null>();
  if (!desk) throw new Error("Comptoir introuvable");
  if (desk.warehouseId) {
    const w = await WarehouseModel.exists({ _id: desk.warehouseId, tenantId }).session(session ?? null);
    if (w) return desk.warehouseId;
  }
  const code = `CPT-${String(desk._id).slice(-6).toUpperCase()}`;
  let wh = await WarehouseModel.findOne({ tenantId, code }).session(session ?? null).lean<{ _id: Types.ObjectId } | null>();
  if (!wh) {
    const [c] = await WarehouseModel.create([{ tenantId, code, name: `Comptoir ${desk.name}`, kind: "comptoir", deskId: desk._id }], { session });
    wh = { _id: c._id as Types.ObjectId };
  }
  await ActivityDeskModel.updateOne({ _id: desk._id }, { $set: { warehouseId: wh._id } }, { session });
  return wh._id;
}

/**
 * Articles du comptoir reliés au catalogue : quantité = stock de la réserve,
 * coût = coût moyen de l'article. Recopié avant lecture (liste, synthèse,
 * rapport) pour que l'écran du comptoir et la gestion de stock disent la même chose.
 */
export async function syncLinkedItems(tenantId: string, deskId: unknown) {
  const items = await ActivityItemModel.find({ tenantId, deskId, productId: { $exists: true, $ne: null } })
    .select("_id productId quantity unitCost").lean<Array<{ _id: Types.ObjectId; productId: Types.ObjectId; quantity: number; unitCost: number }>>();
  if (!items.length) return;
  const whId = await deskWarehouse(tenantId, deskId);
  const [rows, products] = await Promise.all([
    ProductStockModel.find({ tenantId, warehouseId: whId, productId: { $in: items.map(i => i.productId) } }).lean<Array<{ productId: Types.ObjectId; qty: number }>>(),
    ProductModel.find({ tenantId, _id: { $in: items.map(i => i.productId) } }).select("purchaseCost").lean<Array<{ _id: Types.ObjectId; purchaseCost?: number }>>(),
  ]);
  const qty = new Map(rows.map(r => [String(r.productId), r.qty]));
  const cost = new Map(products.map(p => [String(p._id), p.purchaseCost ?? 0]));
  const ops = items
    .map(i => ({ i, q: qty.get(String(i.productId)) ?? 0, c: cost.get(String(i.productId)) ?? i.unitCost }))
    .filter(x => x.q !== x.i.quantity || x.c !== x.i.unitCost)
    .map(x => ({ updateOne: { filter: { _id: x.i._id }, update: { $set: { quantity: Math.max(0, x.q), unitCost: x.c } } } }));
  if (ops.length) await ActivityItemModel.bulkWrite(ops);
}
