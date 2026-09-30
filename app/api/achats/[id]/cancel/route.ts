import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, notFound, badRequest, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { PurchaseModel } from "@/models/Purchase";
import { CommandeModel } from "@/models/Commande";
import { cancelPurchase, PurchaseError } from "@/lib/purchases";
import { logAudit } from "@/lib/audit";

/** POST — { reason } : annule un achat validé par extourne (aucun règlement actif). */
export const POST = withAuth("purchases", "delete", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const p = await PurchaseModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!p) return notFound("Achat introuvable");
  const body = await req.json().catch(() => ({}));
  const reason = String(body.reason ?? "").trim();
  if (!reason) return badRequest("Indiquez le motif de l'annulation.");
  try {
    await withTransaction(async session => {
      await cancelPurchase(auth, p, reason, session);
      if (p.commandeId) await CommandeModel.updateOne({ _id: p.commandeId, purchaseId: p._id }, { $unset: { purchaseId: 1 } }, { session });
    });
  } catch (e) { if (e instanceof PurchaseError) return badRequest(e.message); throw e; }
  await logAudit(auth, "UPDATE", "purchases", { resourceId: params.id, after: { status: "cancelled", reason } });
  return ok(p);
});
