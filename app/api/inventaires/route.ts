import { NextRequest } from "next/server";
import { withAuth, ok, created, badRequest, getPagination, paginatedResponse, tenantFilter } from "@/lib/api-helpers";
import { InventoryCountModel } from "@/models/InventoryCount";
import { ProductModel } from "@/models/Product";
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
  const running = await InventoryCountModel.findOne({
    ...tenantFilter(auth), status: { $in: ["draft", "counting", "review"] },
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
  if (Array.isArray(body.productIds) && body.productIds.length > 0) {
    productFilter._id = { $in: body.productIds };
  }

  const products = await ProductModel.find(productFilter)
    .select("code label unit stockQty")
    .sort({ code: 1 }).limit(5_000)
    .lean<Array<{ _id: unknown; code: string; label: string; unit?: string; stockQty?: number }>>();

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
    location: body.location ? String(body.location).slice(0, 120) : undefined,
    blind: body.blind !== false,
    recountThresholdQty: Number(body.recountThresholdQty) || 10,
    recountThresholdPercent: Number(body.recountThresholdPercent) || 10,
    reasonThresholdValue: Number(body.reasonThresholdValue) || 50_000,
    openedAt: now,
    openedBy: auth.userId,
    createdBy: auth.userId,
    notes: body.notes ? String(body.notes).slice(0, 2000) : undefined,
    lines: products.map(p => ({
      productId: p._id,
      code: p.code,
      label: p.label,
      unit: p.unit,
      theoreticalQty: p.stockQty ?? 0,
      countedQty: null,
      recountQty: null,
      unitCost: weightedAverageCost(byProduct.get(String(p._id)) ?? []),
    })),
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
