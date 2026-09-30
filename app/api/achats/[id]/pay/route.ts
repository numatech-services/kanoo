import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, notFound, badRequest, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { PurchaseModel } from "@/models/Purchase";
import { payPurchase, PurchaseError } from "@/lib/purchases";
import { logAudit } from "@/lib/audit";

/** POST — { amount?, date?, treasuryAccountId, reference? } : règlement total ou partiel. */
export const POST = withAuth("purchases", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const p = await PurchaseModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!p) return notFound("Achat introuvable");
  const body = await req.json().catch(() => ({}));
  try {
    const r = await withTransaction(session => payPurchase(auth, p, body, session));
    await logAudit(auth, "PAYMENT", "purchases", { resourceId: params.id, after: { amount: r.amount, status: p.status } });
    return ok(p);
  } catch (e) { if (e instanceof PurchaseError) return badRequest(e.message); throw e; }
});
