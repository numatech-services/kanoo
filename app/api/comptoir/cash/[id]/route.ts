import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, noContent, notFound, tenantFilter } from "@/lib/api-helpers";
import { ActivityCashEntryModel } from "@/models/ActivityCashEntry";
import { ActivityStockMoveModel } from "@/models/ActivityStockMove";
import { ActivityItemModel } from "@/models/ActivityItem";
import { isId, deskFilter } from "@/lib/comptoir";
import { reverseCashFlow } from "@/lib/cash-posting";
import { reverseMovement } from "@/lib/stock";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Suppression d'une écriture de caisse du comptoir.
 *
 * Elle effaçait la ligne sans rien défaire : l'écriture comptable (5x / 70x /
 * 443) et le mouvement de trésorerie restaient, la caisse et la comptabilité
 * divergeaient. Désormais, dans la même transaction :
 *  - écriture comptable et mouvement de trésorerie extournés ;
 *  - si l'écriture encaissait une VENTE, l'article revient en stock (mouvement
 *    central annulé, ou réserve du comptoir recréditée) — sinon la sortie
 *    restait sans recette.
 */
export const DELETE = withAuth("comptoir", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!isId(params.id)) return notFound("Écriture introuvable");
  const found = await withTransaction(async session => {
    const e = await ActivityCashEntryModel.findOneAndDelete({ _id: params.id, ...tenantFilter(auth), ...deskFilter(auth) }, { session });
    if (!e) return null;
    const reason = `écriture de caisse supprimée : ${e.label}`.slice(0, 200);
    await reverseCashFlow({ tenantId: auth.tenantId, userId: auth.userId, entryId: e.entryId, movementId: e.movementId, reason }, session);

    if (e.linkedMoveId) {
      const move = await ActivityStockMoveModel.findOne({ _id: e.linkedMoveId, tenantId: auth.tenantId }).session(session ?? null);
      if (move && move.type === "out") {
        const item = await ActivityItemModel.findOne({ _id: move.itemId, tenantId: auth.tenantId }).session(session ?? null);
        let after = (item?.quantity ?? 0) + move.quantity;
        if (move.stockMovementId) {
          const r = await reverseMovement({ tenantId: auth.tenantId, userId: auth.userId, movementId: move.stockMovementId, reason: "Vente du comptoir annulée" }, session);
          if (r && typeof (r as { after?: number }).after === "number") after = (r as { after: number }).after;
        }
        if (item) { item.quantity = Math.max(0, after); await item.save({ session }); }
        await ActivityStockMoveModel.create([{
          tenantId: auth.tenantId, deskId: move.deskId, itemId: move.itemId, type: "in",
          quantity: move.quantity, quantityAfter: Math.max(0, after), unitCost: move.unitCost,
          reason: "Annulation de vente", date: new Date(), createdBy: auth.userId,
        }], { session });
      }
    }
    return e;
  });
  if (!found) return notFound("Écriture introuvable");
  await logAudit(auth, "DELETE", "comptoir", { resourceId: String(params.id), before: { label: found.label, amount: found.amount, direction: found.direction } });
  return noContent();
});
