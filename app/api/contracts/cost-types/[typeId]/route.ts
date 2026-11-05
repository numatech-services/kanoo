import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, forbidden, notFound } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { hasFinanceAccess } from "@/lib/role-resources";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { updateCostType } from "@/lib/market-costs";

export const dynamic = "force-dynamic";

/** PATCH { label?, accountCode?, accountLabel?, isActive? } — le compte d'un type se règle à la comptabilité. */
export const PATCH = withAuth("contracts", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  if (!hasFinanceAccess(auth)) return forbidden("Réservé au gérant et à la comptabilité.");
  await connectDB();
  if (!Types.ObjectId.isValid(params.typeId)) return notFound("Type de dépense introuvable");
  const body = await req.json().catch(() => ({}));
  try {
    const t = await updateCostType(auth, params.typeId, body);
    await logAudit(auth, "UPDATE", "contracts", { resourceId: String(t._id), metadata: { costType: t.label, accountCode: t.accountCode, isActive: t.isActive } });
    return ok(t);
  } catch (e) {
    if (e instanceof BusinessRuleError) return badRequest(e.message);
    throw e;
  }
});
