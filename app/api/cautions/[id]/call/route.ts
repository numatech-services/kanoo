import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, badRequest, forbidden } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { hasFinanceAccess } from "@/lib/role-resources";
import { callGuarantee } from "@/lib/guarantees-server";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** POST { amount?, date?, treasuryAccountId?, manualPosting? } — caution appelée (voir callGuarantee). */
export const POST = withAuth("appels", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  if (!hasFinanceAccess(auth)) return forbidden("Opération comptabilisée : réservée au gérant et à la comptabilité.");
  await connectDB();
  const body = await req.json().catch(() => ({}));
  try {
    const { guarantee: g, warning } = await withTransaction(session => callGuarantee({ tenantId: auth.tenantId, userId: auth.userId }, params.id, body, session));
    await logAudit(auth, "UPDATE", "appels", { resourceId: params.id, metadata: { guarantee: "call", status: g.status, amount: g.calledAmount, manualPosting: body.manualPosting === true } });
    return ok({ ...(g.toObject ? g.toObject() : g), warning });
  } catch (e) {
    if (e instanceof BusinessRuleError) return badRequest(e.message);
    throw e;
  }
});
