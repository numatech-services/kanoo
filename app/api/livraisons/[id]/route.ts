import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, notFound, noContent, tenantFilter, sanitizeBody } from "@/lib/api-helpers";
import { DeliveryNoteModel } from "@/models/DeliveryNote";
import { StockMovementModel } from "@/models/StockMovement";
import { reverseMovement } from "@/lib/stock";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import { authCan } from "@/lib/role-resources";

// Un bon de livraison relève des livraisons (Administration, Achats), pas de la
// facturation : le détail répondait 403 à qui gérait pourtant la liste.
export const GET = withAuth("livraisons", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const item = await DeliveryNoteModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .populate("invoiceId", authCan(auth, "invoices", "read") ? "number totalTTC issueDate" : "number issueDate")
    .populate("clientId", "name code nif address phone")
    .lean();
  if (!item) return notFound();
  return ok(item);
});

export const PATCH = withAuth("livraisons", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  // Les lignes ont déjà sorti le stock : on ne les modifie pas après coup (on
  // annule le bon et on en émet un autre). Statut, date, notes restent modifiables.
  const body = sanitizeBody(await req.json(), ["number", "lines", "invoiceId", "clientId"]);
  const item = await DeliveryNoteModel.findOneAndUpdate(
    { _id: params.id, ...tenantFilter(auth) }, { $set: body }, { new: true, runValidators: true }
  );
  if (!item) return notFound();
  await logAudit(auth, "UPDATE", "livraisons", { resourceId: params.id });
  return ok(item);
});

/**
 * DELETE — annule un bon de livraison et remet en stock ce qu'il avait sorti,
 * dans la même transaction, avec un mouvement « retour » traçable.
 */
export const DELETE = withAuth("livraisons", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const note = await DeliveryNoteModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!note) return notFound();

  await withTransaction(async (session) => {
    // Contre-mouvement de chaque sortie du bon : on rend exactement ce qui était
    // sorti (la sortie avait pu être plafonnée au stock disponible).
    const exits = await StockMovementModel.find({ tenantId: auth.tenantId, type: "exit", linkedDocNumber: note.number, reversedBy: { $exists: false } })
      .select("_id quantity").session(session ?? null).lean<Array<{ _id: unknown; quantity: number }>>();
    for (const m of exits) {
      if (!m.quantity) continue;
      await reverseMovement({ tenantId: auth.tenantId, userId: auth.userId, movementId: m._id, reason: `annulation du BL ${note.number}` }, session);
    }
    await DeliveryNoteModel.deleteOne({ _id: note._id }, { session });
  });

  await logAudit(auth, "DELETE", "livraisons", { resourceId: params.id, before: { number: note.number } });
  return noContent();
});
