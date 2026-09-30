import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, notFound, badRequest, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { PurchaseModel } from "@/models/Purchase";
import { cancelPayment, PurchaseError } from "@/lib/purchases";
import { logAudit } from "@/lib/audit";

/** DELETE — annule un règlement (extourne + mouvement de trésorerie inverse). */
export const DELETE = withAuth("purchases", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const p = await PurchaseModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!p) return notFound("Achat introuvable");
  try { await withTransaction(session => cancelPayment(auth, p, params.paymentId, session)); }
  catch (e) { if (e instanceof PurchaseError) return badRequest(e.message); throw e; }
  await logAudit(auth, "UPDATE", "purchases", { resourceId: params.id, metadata: { paymentCancelled: params.paymentId } });
  return ok(p);
});
