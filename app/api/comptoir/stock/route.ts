import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, created, badRequest, notFound, tenantFilter, requireFields } from "@/lib/api-helpers";
import { ActivityItemModel } from "@/models/ActivityItem";
import { ActivityStockMoveModel } from "@/models/ActivityStockMove";
import { ActivityCashEntryModel } from "@/models/ActivityCashEntry";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Historique des mouvements de stock d'un comptoir (option: un article donné).
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const deskId = url.searchParams.get("deskId");
  if (!deskId) return badRequest("deskId requis");
  const filter: Record<string, unknown> = { ...tenantFilter(auth), deskId };
  const itemId = url.searchParams.get("itemId");
  if (itemId) filter.itemId = itemId;
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
  const err = requireFields(body, ["deskId", "itemId", "type", "quantity"]);
  if (err) return badRequest(err);
  const type = body.type as "in" | "out" | "adjust";
  if (!["in", "out", "adjust"].includes(type)) return badRequest("Type de mouvement invalide");
  const qty = Math.abs(Number(body.quantity) || 0);
  if (!(qty > 0)) return badRequest("Quantité invalide");

  const result = await withTransaction(async (session) => {
    const item = await ActivityItemModel.findOne({ _id: body.itemId, ...tenantFilter(auth), deskId: body.deskId }).session(session ?? null);
    if (!item) return { error: "Article introuvable" as const };

    const before = item.quantity || 0;
    let after: number;
    if (type === "in") after = before + qty;
    else if (type === "out") {
      if (qty > before) return { error: "Stock insuffisant pour cette sortie" as const };
      after = before - qty;
    } else after = qty; // ajustement : la quantité DEVIENT la valeur saisie

    const [move] = await ActivityStockMoveModel.create([{
      tenantId: auth.tenantId, deskId: body.deskId, itemId: item._id,
      type, quantity: type === "adjust" ? Math.abs(after - before) : qty, quantityAfter: after,
      unitCost: body.unitCost != null ? Math.max(0, Number(body.unitCost)) : item.unitCost,
      reason: String(body.reason || "").slice(0, 300),
      date: body.date ? new Date(body.date) : new Date(),
      createdBy: auth.userId,
    }], { session });

    item.quantity = after;
    if (type === "in" && body.unitCost != null) item.unitCost = Math.max(0, Number(body.unitCost));
    await item.save({ session });

    // Vente : encaissement de caisse lié, si un montant est fourni.
    let cash = null;
    if (type === "out" && body.cashAmount != null && Number(body.cashAmount) > 0) {
      [cash] = await ActivityCashEntryModel.create([{
        tenantId: auth.tenantId, deskId: body.deskId, direction: "in",
        amount: Number(body.cashAmount), label: `Vente : ${item.name} × ${qty}`,
        method: body.cashMethod || "cash", date: body.date ? new Date(body.date) : new Date(),
        linkedMoveId: move._id, createdBy: auth.userId,
      }], { session });
    }
    return { move, cash };
  });

  if ("error" in result && result.error) {
    return result.error === "Article introuvable" ? notFound(result.error) : badRequest(result.error);
  }
  await logAudit(auth, "CREATE", "comptoir", { metadata: { move: type, itemId: String(body.itemId) } });
  return created(result);
});
