import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, badRequest, forbidden } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { hasFinanceAccess } from "@/lib/role-resources";
import { chargeGuarantee } from "@/lib/guarantees-server";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** POST { kind: commission | prorogation | dossier | autre, amount?, date? } — frais de la caution (631 contre la banque). */
export const POST = withAuth("appels", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  if (!hasFinanceAccess(auth)) return forbidden("Opération comptabilisée : réservée au gérant et à la comptabilité.");
  await connectDB();
  const body = await req.json().catch(() => ({}));
  try {
    const g = await withTransaction(session => chargeGuarantee({ tenantId: auth.tenantId, userId: auth.userId }, params.id, body, session));
    await logAudit(auth, "UPDATE", "appels", { resourceId: params.id, metadata: { guarantee: "charge", amount: body.amount ?? body.fee, kind: body.kind, status: g.status } });
    return ok(g);
  } catch (e) {
    if (e instanceof BusinessRuleError) return badRequest(e.message);
    throw e;
  }
});
