import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, noContent, notFound, badRequest, tenantFilter, sanitizeBody } from "@/lib/api-helpers";
import { isId, deskFilter, parsePack } from "@/lib/comptoir";
import { ActivityItemModel } from "@/models/ActivityItem";
import { ActivityStockMoveModel } from "@/models/ActivityStockMove";
import { logAudit } from "@/lib/audit";
import { withTransaction } from "@/lib/db";
import { ProductModel } from "@/models/Product";
import { ProductStockModel } from "@/models/ProductStock";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { applyMovement, StockError } from "@/lib/stock";
import { deskWarehouse, syncLinkedItems } from "@/lib/comptoir-stock";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const PATCH = withAuth("comptoir", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!isId(params.id)) return notFound("Article introuvable");
  const body = await req.json().catch(() => ({}));
  const clean = sanitizeBody(body);
  // La quantité n'est jamais fixée à la main : elle ne bouge que par un mouvement
  // de stock (traçabilité). On n'autorise donc pas `quantity` ici.
  const update: Record<string, unknown> = {};
  if ("name" in clean) update.name = String(clean.name || "").slice(0, 160).trim();
  if ("unit" in clean) update.unit = String(clean.unit || "unité").slice(0, 24);
  if ("sku" in clean) update.sku = String(clean.sku || "").slice(0, 60);
  if ("archived" in clean) update.archived = Boolean(clean.archived);
  if ("category" in clean) update.category = String(clean.category || "").trim().slice(0, 60) || undefined;
  // Fiche recette : ingrédients = autres articles du même comptoir, sans recette eux-mêmes.
  if ("recipe" in clean) {
    const raw = Array.isArray(clean.recipe) ? clean.recipe as Array<{ itemId?: string; quantity?: number }> : [];
    const lines = raw.filter(r => isId(r.itemId) && Number(r.quantity) > 0).map(r => ({ itemId: String(r.itemId), quantity: Math.round(Number(r.quantity) * 10000) / 10000 }));
    if (lines.some(r => r.itemId === params.id)) return badRequest("Un article ne peut pas être son propre ingrédient.");
    if (lines.length) {
      const cur = await ActivityItemModel.findOne({ _id: params.id, ...tenantFilter(auth) }).select("deskId").lean<{ deskId: unknown } | null>();
      const ings = await ActivityItemModel.find({ _id: { $in: lines.map(r => r.itemId) }, ...tenantFilter(auth), deskId: cur?.deskId }).select("recipe").lean<Array<{ recipe?: unknown[] }>>();
      if (ings.length !== new Set(lines.map(r => r.itemId)).size) return badRequest("Ingrédient introuvable sur ce comptoir.");
      if (ings.some(i => i.recipe?.length)) return badRequest("Un ingrédient ne peut pas être lui-même une préparation.");
    }
    update.recipe = lines;
  }
  if ("pack" in clean) {
    const pack = parsePack(clean.pack);
    if (pack === "invalid") return badRequest("Conditionnement invalide (nombre d'unités par paquet, prix du paquet).");
    update.pack = pack ?? undefined;
  }
  for (const f of ["unitCost", "salePrice", "threshold"]) {
    if (f in clean) {
      const n = Number(clean[f]);
      if (!Number.isFinite(n) || n < 0) return badRequest(`Valeur invalide : ${f}`);
      update[f] = n;
    }
  }
  if (update.name === "") return badRequest("Le nom est requis.");

  // Rattachement au catalogue : le stock propre du comptoir entre dans sa
  // réserve (reprise tracée) ; détachement : la quantité est figée.
  if ("productId" in clean) {
    const cur = await ActivityItemModel.findOne({ _id: params.id, ...tenantFilter(auth), ...deskFilter(auth) });
    if (!cur) return notFound("Article introuvable");
    if (clean.productId && String(clean.productId) !== String(cur.productId ?? "")) {
      if (cur.productId) return badRequest("Détachez d'abord l'article actuel.");
      if (!isId(clean.productId)) return badRequest("Article du catalogue invalide.");
      const p = await ProductModel.findOne({ _id: clean.productId, ...tenantFilter(auth), isService: { $ne: true } }).select("trackingMode label").lean<{ _id: unknown; trackingMode?: string; label: string } | null>();
      if (!p) return badRequest("Article du catalogue introuvable (ou service).");
      if (await ActivityItemModel.exists({ ...tenantFilter(auth), deskId: cur.deskId, productId: p._id, archived: { $ne: true } })) return badRequest("Cet article du catalogue est déjà au comptoir.");
      try {
        await withTransaction(async session => {
          const whId = await deskWarehouse(auth.tenantId, cur.deskId, session);
          if ((cur.quantity ?? 0) > 0) {
            await applyMovement({
              tenantId: auth.tenantId, userId: auth.userId, productId: p._id, type: "entry", warehouseId: whId,
              quantity: cur.quantity, unitCost: cur.unitCost || undefined, reason: `Reprise du stock du comptoir (${cur.name})`,
              lots: p.trackingMode && p.trackingMode !== "none" ? [{ lotNumber: "REPRISE-COMPTOIR", qty: cur.quantity }] : undefined,
              linkedDocType: "comptoir", linkedDocId: cur._id,
            }, session);
          }
          await ActivityItemModel.updateOne({ _id: cur._id }, { $set: { ...update, productId: p._id } }, { session });
        });
      } catch (e) { if (e instanceof StockError) return badRequest(e.message); throw e; }
      await syncLinkedItems(auth.tenantId, cur.deskId);
      await logAudit(auth, "UPDATE", "comptoir", { resourceId: String(params.id), metadata: { linkedProduct: String(p._id) } });
      return ok(await ActivityItemModel.findById(cur._id).lean());
    }
    if (!clean.productId && cur.productId) {
      // Détachement : la réserve SORT du stock de l'entreprise et devient le
      // stock propre du comptoir, valorisée au CMUP. Elle restait des deux
      // côtés (réserve + quantité figée) : comptée deux fois.
      try {
        await withTransaction(async session => {
          const whId = await deskWarehouse(auth.tenantId, cur.deskId, session);
          const row = await ProductStockModel.findOne({ ...tenantFilter(auth), productId: cur.productId, warehouseId: whId }).select("qty").session(session ?? null).lean<{ qty: number } | null>();
          let qty = 0, unitCost = cur.unitCost || 0;
          if ((row?.qty ?? 0) > 0) {
            const r = await applyMovement({
              tenantId: auth.tenantId, userId: auth.userId, productId: cur.productId, type: "exit", warehouseId: whId,
              quantity: row!.qty, allowPartial: true, reason: `Détachement du catalogue (${cur.name}) : stock repris par le comptoir`,
              linkedDocType: "comptoir", linkedDocId: cur._id,
            }, session);
            qty = Math.abs(Number(r.movement.quantity) || 0);
            unitCost = Number(r.movement.unitCost) || unitCost;
          }
          await ActivityItemModel.updateOne({ _id: cur._id }, { $set: { quantity: qty, unitCost }, $unset: { productId: 1 } }, { session });
        });
      } catch (e) { if (e instanceof StockError) return badRequest(e.message); throw e; }
    }
  }
  const item = await ActivityItemModel.findOneAndUpdate(
    { _id: params.id, ...tenantFilter(auth), ...deskFilter(auth) }, { $set: update }, { new: true }
  );
  if (!item) return notFound("Article introuvable");
  await logAudit(auth, "UPDATE", "comptoir", { resourceId: String(params.id) });
  return ok(item);
});

export const DELETE = withAuth("comptoir", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!isId(params.id)) return notFound("Article introuvable");
  const it = await ActivityItemModel.findOne({ _id: params.id, ...tenantFilter(auth), ...deskFilter(auth) })
    .select("productId deskId name").lean<{ _id: unknown; productId?: unknown; deskId: unknown; name: string } | null>();
  if (!it) return notFound("Article introuvable");
  // Article relié : la réserve du comptoir est du stock réel de l'entreprise ;
  // on ne la laisse pas orpheline.
  if (it.productId) {
    const desk = await ActivityDeskModel.findOne({ _id: it.deskId, ...tenantFilter(auth) }).select("warehouseId").lean<{ warehouseId?: unknown } | null>();
    const row = desk?.warehouseId
      ? await ProductStockModel.findOne({ ...tenantFilter(auth), productId: it.productId, warehouseId: desk.warehouseId }).select("qty").lean<{ qty: number } | null>()
      : null;
    if ((row?.qty ?? 0) > 0) return badRequest(`« ${it.name} » a encore ${row!.qty} en réserve : renvoyez-les au magasin (Retour des invendus) ou sortez-les avant de supprimer l'article.`);
  }
  // Article propre : son stock ne disparaît pas sans trace.
  const own = await ActivityItemModel.findById(it._id).select("quantity").lean<{ quantity?: number } | null>();
  if (!it.productId && (own?.quantity ?? 0) > 0) {
    return badRequest(`« ${it.name} » a encore ${own!.quantity} en stock : enregistrez une sortie (casse, perte) ou un inventaire à zéro avant de le supprimer.`);
  }
  // Un article déjà vendu ou mouvementé est archivé : ses tickets et son
  // historique gardent leur référence.
  if (await ActivityStockMoveModel.exists({ tenantId: auth.tenantId, itemId: it._id })) {
    await ActivityItemModel.updateOne({ _id: it._id }, { $set: { archived: true } });
    await logAudit(auth, "UPDATE", "comptoir", { resourceId: String(params.id), metadata: { archived: true } });
    return ok({ archived: true });
  }
  await ActivityItemModel.deleteOne({ _id: it._id });
  await logAudit(auth, "DELETE", "comptoir", { resourceId: String(params.id) });
  return noContent();
});
