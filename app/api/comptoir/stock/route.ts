import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, created, badRequest, notFound, tenantFilter, requireFields } from "@/lib/api-helpers";
import { isId, ownDesk, postDeskCash } from "@/lib/comptoir";
import { ActivityItemModel } from "@/models/ActivityItem";
import { ActivityStockMoveModel } from "@/models/ActivityStockMove";
import { ActivityCashEntryModel } from "@/models/ActivityCashEntry";
import { logAudit } from "@/lib/audit";
import { applyMovement } from "@/lib/stock";
import { deskWarehouse } from "@/lib/comptoir-stock";
import { notifyRoles } from "@/lib/notify";
import { assertDayOpen } from "@/lib/comptoir-sale";
import { packEntry } from "@/lib/comptoir-economics";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Historique des mouvements de stock d'un comptoir (option: un article donné).
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const deskId = url.searchParams.get("deskId");
  if (!isId(deskId)) return badRequest("Comptoir invalide");
  if (!(await ownDesk(auth, deskId))) return notFound("Comptoir introuvable");
  const filter: Record<string, unknown> = { ...tenantFilter(auth), deskId };
  const itemId = url.searchParams.get("itemId");
  if (isId(itemId)) filter.itemId = itemId;
  const moves = await ActivityStockMoveModel.find(filter)
    .populate("itemId", "name unit")
    .sort({ date: -1, createdAt: -1 }).limit(200).lean();
  return ok(moves);
});

// Enregistre un mouvement (entrée / sortie / ajustement) et met le stock à jour
// dans une transaction. Une sortie (vente) peut créer une entrée de caisse liée.
export const POST = withAuth("comptoir", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const err = requireFields(body, Number(body.packs) > 0 ? ["deskId", "itemId", "type"] : ["deskId", "itemId", "type", "quantity"]);
  if (err) return badRequest(err);
  if (!isId(body.itemId)) return badRequest("Article invalide");
  if (!(await ownDesk(auth, body.deskId))) return notFound("Comptoir introuvable");
  const type = body.type as "in" | "out" | "adjust";
  if (!["in", "out", "adjust"].includes(type)) return badRequest("Type de mouvement invalide");
  // Entrée par paquets : « 3 paquets de 24 à 5 100 » → 72 unités à 212,50.
  if (type === "in" && Number(body.packs) > 0) {
    const it = await ActivityItemModel.findOne({ _id: body.itemId, ...tenantFilter(auth), deskId: body.deskId }).select("pack").lean<{ pack?: { size?: number; cost?: number } } | null>();
    if (!it?.pack?.size) return badRequest("Cet article n'a pas de conditionnement : saisissez la quantité en unités.");
    const e = packEntry(Number(body.packs), it.pack, Number(body.packCost) || undefined);
    body.quantity = e.quantity;
    if (e.unitCost > 0) body.unitCost = e.unitCost;
    if (e.packCost && e.packCost !== it.pack.cost) await ActivityItemModel.updateOne({ _id: body.itemId }, { $set: { "pack.cost": e.packCost } });
  }
  const qty = Math.abs(Number(body.quantity) || 0);
  // Un ajustement d'inventaire peut ramener le stock à 0 (casse, perte totale) ;
  // une entrée ou une sortie doit porter sur une quantité positive.
  if (type === "adjust" ? !(qty >= 0) : !(qty > 0)) return badRequest("Quantité invalide");
  const CASH_METHODS = ["cash", "bank_transfer", "orange_money", "card", "check", "other"];
  const cashMethod = CASH_METHODS.includes(body.cashMethod) ? body.cashMethod : "cash";

  const result = await withTransaction(async (session) => {
    await assertDayOpen(auth.tenantId, body.deskId, body.date ? new Date(body.date) : new Date(), session);
    const item = await ActivityItemModel.findOne({ _id: body.itemId, ...tenantFilter(auth), deskId: body.deskId }).session(session ?? null);
    if (!item) return { error: "Article introuvable" as const };

    const before = item.quantity || 0;
    let after: number;
    let stockMovementId: unknown;
    if (item.productId) {
      // Article du catalogue : le mouvement passe par la gestion de stock, dans
      // la réserve du comptoir (lots pris péremption la plus proche d'abord).
      const whId = await deskWarehouse(auth.tenantId, body.deskId, session);
      {
        // Une erreur de stock interrompt la transaction (rien n'est écrit) et
        // revient en 400 avec son message.
        const r = await applyMovement({
          tenantId: auth.tenantId, userId: auth.userId, productId: item.productId, warehouseId: whId,
          type: type === "in" ? "entry" : type === "out" ? "exit" : "adjustment", quantity: qty,
          unitCost: type === "in" && body.unitCost != null ? Number(body.unitCost) : undefined,
          lots: Array.isArray(body.lots) ? body.lots : undefined,
          reason: String(body.reason || (type === "out" ? "Vente au comptoir" : type === "in" ? "Achat au comptoir" : "Inventaire du comptoir")).slice(0, 300),
          linkedDocType: "comptoir", linkedDocId: body.deskId,
        }, session);
        after = r.after;
        stockMovementId = r.movement._id;
      }
    } else if (type === "in") after = before + qty;
    else if (type === "out") {
      if (qty > before) return { error: "Stock insuffisant pour cette sortie" as const };
      after = before - qty;
    } else after = qty; // ajustement : la quantité DEVIENT la valeur saisie

    const [move] = await ActivityStockMoveModel.create([{
      tenantId: auth.tenantId, deskId: body.deskId, itemId: item._id,
      type, quantity: type === "adjust" ? Math.abs(after - before) : qty, quantityAfter: after,
      unitCost: body.unitCost != null ? Math.max(0, Number(body.unitCost)) : item.unitCost,
      reason: String(body.reason || "").slice(0, 300),
      stockMovementId,
      date: body.date ? new Date(body.date) : new Date(),
      createdBy: auth.userId,
    }], { session });

    item.quantity = Math.max(0, after);
    if (type === "in" && body.unitCost != null) item.unitCost = Math.max(0, Number(body.unitCost));
    await item.save({ session });

    // Passage sous le seuil d'alerte à la suite de ce mouvement ?
    const crossedThreshold = item.threshold != null && after <= item.threshold && before > item.threshold;

    // Vente : encaissement de caisse lié, si un montant est fourni.
    let cash = null;
    if (type === "out" && body.cashAmount != null && Number(body.cashAmount) > 0) {
      [cash] = await ActivityCashEntryModel.create([{
        tenantId: auth.tenantId, deskId: body.deskId, direction: "in",
        amount: Number(body.cashAmount), label: `Vente : ${item.name} × ${qty}`,
        method: cashMethod, date: body.date ? new Date(body.date) : new Date(),
        linkedMoveId: move._id, createdBy: auth.userId,
      }], { session });
      await postDeskCash(auth, body.deskId, cash, session);
    }
    return { move, cash, crossedThreshold, itemName: item.name, itemUnit: item.unit, after, threshold: item.threshold };
  });

  if ("error" in result && result.error) {
    return result.error === "Article introuvable" ? notFound(result.error) : badRequest(String(result.error));
  }
  // Alerte de réapprovisionnement : notifiée à la direction, au comptable et au
  // gestionnaire de comptoir. Best-effort, hors transaction.
  if ("crossedThreshold" in result && result.crossedThreshold) {
    await notifyRoles(auth.tenantId, ["pme_admin", "pme_manager", "pme_accountant", "pme_activity_manager", "svc_spot", "svc_compta"], {
      type: "stock_alert", title: "Comptoir : seuil atteint",
      message: `${result.itemName} : ${result.after} ${result.itemUnit} en stock (seuil ${result.threshold}). Réapprovisionnement conseillé.`,
      linkedTo: "comptoir", linkedId: String(body.deskId),
    });
  }
  await logAudit(auth, "CREATE", "comptoir", { metadata: { move: type, itemId: String(body.itemId) } });
  return created(result);
});
