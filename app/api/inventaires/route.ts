import { NextRequest } from "next/server";
import { withAuth, created, badRequest, getPagination, paginatedResponse, tenantFilter } from "@/lib/api-helpers";
import { InventoryCountModel } from "@/models/InventoryCount";
import { ProductModel } from "@/models/Product";
import { Types } from "mongoose";
import { WarehouseModel } from "@/models/Warehouse";
import { ProductStockModel } from "@/models/ProductStock";
import { StockLotModel } from "@/models/StockLot";
import { defaultWarehouse, migrateLegacyStock } from "@/lib/stock";
import { StockMovementModel } from "@/models/StockMovement";
import { weightedAverageCost } from "@/lib/inventory";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const GET = withAuth("products", "read", async (req: NextRequest, auth: TokenPayload) => {
  const pagination = getPagination(req);
  const filter = { ...tenantFilter(auth) };

  const [items, total] = await Promise.all([
    InventoryCountModel.find(filter)
      .select("-lines")   // les lignes ne servent qu'au détail
      .sort({ createdAt: -1 })
      .skip(pagination.skip).limit(pagination.limit)
      .populate("createdBy", "firstName lastName")
      .lean(),
    InventoryCountModel.countDocuments(filter),
  ]);

  return paginatedResponse(items, total, pagination);
});

/**
 * POST /api/inventaires — ouvrir une session de comptage.
 *
 * L'ouverture **photographie** le stock : quantité théorique et coût unitaire
 * sont figés ligne par ligne. Sans cette photographie, une vente saisie
 * pendant le comptage transformerait un stock juste en écart, et un écart réel
 * en stock juste — et l'inventaire ne prouverait rien.
 *
 * Le coût est un coût unitaire moyen pondéré reconstitué à partir des
 * mouvements d'entrée valorisés. Le modèle Produit ne porte qu'un prix de
 * vente : valoriser un manquant au prix de vente compterait comme perdue une
 * marge jamais gagnée.
 */
export const POST = withAuth("products", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json().catch(() => ({}));

  const label = String(body.label || "").trim();
  if (!label) return badRequest("Donnez un intitulé : « Inventaire dépôt Niamey, septembre » se retrouve.");

  // Une session ouverte à la fois : deux comptages simultanés sur le même
  // stock produisent deux vérités, et la seconde validation écrase la première.
  // Entrepôt inventorié (défaut : entrepôt principal) ; une session ouverte par entrepôt.
  await migrateLegacyStock(auth.tenantId);
  let warehouse: { _id: Types.ObjectId; name: string; isDefault?: boolean };
  if (body.warehouseId) {
    if (!Types.ObjectId.isValid(String(body.warehouseId))) return badRequest("Entrepôt invalide.");
    const w = await WarehouseModel.findOne({ _id: body.warehouseId, ...tenantFilter(auth), isActive: true }).select("_id name isDefault").lean<{ _id: Types.ObjectId; name: string; isDefault?: boolean } | null>();
    if (!w) return badRequest("Entrepôt introuvable.");
    warehouse = w;
  } else {
    const d = await defaultWarehouse(auth.tenantId);
    warehouse = { ...d, isDefault: true };
  }
  const running = await InventoryCountModel.findOne({
    ...tenantFilter(auth), status: { $in: ["draft", "counting", "review"] },
    ...(warehouse.isDefault ? { $or: [{ warehouseId: warehouse._id }, { warehouseId: { $exists: false } }] } : { warehouseId: warehouse._id }),
  }).select("reference label").lean<{ reference: string; label: string } | null>();
  if (running) {
    return badRequest(
      `L'inventaire « ${running.label} » (${running.reference}) est encore ouvert. `
      + `Validez-le ou annulez-le avant d'en ouvrir un autre : deux comptages simultanés `
      + `sur le même stock produisent deux vérités.`
    );
  }

  const productFilter: Record<string, unknown> = {
    ...tenantFilter(auth), isActive: true, isService: { $ne: true },
  };
  const whRows = await ProductStockModel.find({ ...tenantFilter(auth), warehouseId: warehouse._id })
    .lean<Array<{ productId: Types.ObjectId; qty: number }>>();
  const whQty = new Map(whRows.map(r => [String(r.productId), r.qty]));
  if (Array.isArray(body.productIds) && body.productIds.length > 0) {
    productFilter._id = { $in: body.productIds };
  } else if (!warehouse.isDefault) {
    // Dépôt secondaire / comptoir : les articles qui y ont du stock.
    productFilter._id = { $in: whRows.filter(r => r.qty !== 0).map(r => r.productId) };
  }

  const products = await ProductModel.find(productFilter)
    .select("code label unit stockQty purchaseCost trackingMode")
    .sort({ code: 1 }).limit(5_000)
    .lean<Array<{ _id: unknown; code: string; label: string; unit?: string; stockQty?: number; purchaseCost?: number; trackingMode?: string }>>();

  if (products.length === 0) {
    return badRequest("Aucun article à compter : le périmètre est vide.");
  }

  // Coûts reconstitués en une seule passe sur les entrées valorisées.
  const entries = await StockMovementModel.find({
    ...tenantFilter(auth),
    productId: { $in: products.map(p => p._id) },
    quantity: { $gt: 0 },
    unitCost: { $gt: 0 },
  }).select("productId quantity unitCost").limit(50_000)
    .lean<Array<{ productId: unknown; quantity: number; unitCost: number }>>();

  const byProduct = new Map<string, Array<{ quantity: number; unitCost: number }>>();
  for (const entry of entries) {
    const key = String(entry.productId);
    const list = byProduct.get(key);
    if (list) list.push(entry);
    else byProduct.set(key, [entry]);
  }

  const lotRows = await StockLotModel.find({ ...tenantFilter(auth), warehouseId: warehouse._id, qty: { $gt: 0 }, productId: { $in: products.map(p => p._id) } })
    .sort({ expiryDate: 1 }).lean<Array<{ productId: Types.ObjectId; lotNumber: string; expiryDate?: Date; qty: number }>>();
  const lotsBy = new Map<string, typeof lotRows>();
  for (const l of lotRows) lotsBy.set(String(l.productId), [...(lotsBy.get(String(l.productId)) ?? []), l]);

  const now = new Date();
  const year = now.getFullYear();
  const count = await InventoryCountModel.countDocuments({
    tenantId: auth.tenantId, reference: new RegExp(`^INV-${year}-`),
  });

  const session = await InventoryCountModel.create({
    tenantId: auth.tenantId,
    reference: `INV-${year}-${String(count + 1).padStart(3, "0")}`,
    label,
    status: "counting",
    scope: productFilter._id ? "selection" : "all",
    location: body.location ? String(body.location).slice(0, 120) : warehouse.name,
    warehouseId: warehouse._id,
    blind: body.blind !== false,
    recountThresholdQty: Number(body.recountThresholdQty) || 10,
    recountThresholdPercent: Number(body.recountThresholdPercent) || 10,
    reasonThresholdValue: Number(body.reasonThresholdValue) || 50_000,
    openedAt: now,
    openedBy: auth.userId,
    createdBy: auth.userId,
    notes: body.notes ? String(body.notes).slice(0, 2000) : undefined,
    // Article suivi par lot : une ligne par lot en stock dans l'entrepôt.
    lines: products.flatMap(p => {
      const unitCost = p.purchaseCost && p.purchaseCost > 0 ? p.purchaseCost : weightedAverageCost(byProduct.get(String(p._id)) ?? []);
      const base = { productId: p._id, code: p.code, label: p.label, unit: p.unit, countedQty: null, recountQty: null, unitCost };
      const lots = lotsBy.get(String(p._id));
      if (p.trackingMode && p.trackingMode !== "none" && lots?.length) {
        return lots.map(l => ({ ...base, label: `${p.label} — lot ${l.lotNumber}`, lotNumber: l.lotNumber, expiryDate: l.expiryDate, theoreticalQty: l.qty }));
      }
      return [{ ...base, theoreticalQty: whQty.get(String(p._id)) ?? 0 }];
    }),
  });

  await logAudit(auth, "CREATE", "products", {
    resourceId: String(session._id),
    metadata: { module: "inventaire", reference: session.reference, lines: products.length },
  });

  return created({
    _id: session._id,
    reference: session.reference,
    lines: products.length,
    unvalued: session.lines.filter((l: { unitCost: number | null }) => l.unitCost === null).length,
  });
});
