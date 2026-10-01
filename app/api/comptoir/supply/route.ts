import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, created, badRequest, notFound, forbidden, tenantFilter, requireFields } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { isId, ownDesk, allDesks } from "@/lib/comptoir";
import { authCan } from "@/lib/role-resources";
import { ActivityItemModel } from "@/models/ActivityItem";
import { ActivityStockMoveModel } from "@/models/ActivityStockMove";
import { transferStock } from "@/lib/stock";
import { deskWarehouse, syncLinkedItems } from "@/lib/comptoir-stock";
import { logAudit } from "@/lib/audit";

/**
 * POST — { deskId, fromWarehouseId, lines: [{ itemId, quantity, lots? }], direction? }
 * Approvisionnement d'un comptoir depuis un entrepôt : transfert vers la
 * réserve du comptoir (lots et péremptions suivent). `direction: "return"` :
 * retour des invendus de la réserve vers cet entrepôt. Réservé au magasin
 * (droit de modifier le stock) et aux responsables de tous les sites.
 */
export const POST = withAuth("comptoir", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const err = requireFields(body, ["deskId", "fromWarehouseId", "lines"]);
  if (err) return badRequest(err);
  if (!authCan(auth, "products", "update") && !allDesks(auth)) return forbidden("L'approvisionnement depuis le magasin est fait par le magasin ou le chef The Spot.");
  const desk = await ownDesk(auth, body.deskId);
  if (!desk) return notFound("Comptoir introuvable");
  const back = body.direction === "return";
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!lines.length) return badRequest(back ? "Aucun article à renvoyer." : "Aucun article à approvisionner.");
  const items = await ActivityItemModel.find({ ...tenantFilter(auth), deskId: desk._id, _id: { $in: lines.map((l: { itemId: string }) => l.itemId).filter(isId) } })
    .lean<Array<{ _id: unknown; productId?: unknown; name: string }>>();
  for (const l of lines) {
    const it = items.find(i => String(i._id) === String(l.itemId));
    if (!it) return badRequest("Article du comptoir introuvable.");
    if (!it.productId) return badRequest(`« ${it.name} » n'est pas relié au catalogue : reliez-le pour l'approvisionner depuis un entrepôt.`);
  }
  const reference = `${back ? "RET" : "APP"}-${new Date().toISOString().slice(0, 10)}-${String(desk._id).slice(-4).toUpperCase()}`;
  await withTransaction(async session => {
    const whId = await deskWarehouse(auth.tenantId, desk._id, session);
    for (const l of lines) {
      const it = items.find(i => String(i._id) === String(l.itemId))!;
      const r = await transferStock({
        tenantId: auth.tenantId, userId: auth.userId, productId: it.productId,
        fromWarehouseId: back ? whId : body.fromWarehouseId, toWarehouseId: back ? body.fromWarehouseId : whId,
        quantity: Math.abs(Number(l.quantity)), lots: l.lots, reason: `${back ? "Retour des invendus" : "Approvisionnement"} ${desk.name}`,
        linkedDocType: "comptoir", linkedDocId: desk._id, linkedDocNumber: reference,
      }, session);
      // Côté comptoir : la jambe qui touche sa réserve.
      const leg = back ? r.out : r.in;
      await ActivityStockMoveModel.create([{
        tenantId: auth.tenantId, deskId: desk._id, itemId: it._id, type: back ? "return" : "supply", quantity: Math.abs(Number(l.quantity)),
        quantityAfter: leg.after, reason: `${back ? "Retour au magasin" : "Approvisionnement"} (${reference})`, stockMovementId: leg.movement._id, date: new Date(), createdBy: auth.userId,
      }], { session });
    }
  });
  await syncLinkedItems(auth.tenantId, desk._id);
  await logAudit(auth, "UPDATE", "comptoir", { metadata: { [back ? "return" : "supply"]: reference, lines: lines.length } });
  return created({ reference });
});
