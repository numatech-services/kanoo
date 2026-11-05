import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, created, badRequest, notFound, forbidden } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { authCan } from "@/lib/role-resources";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { costTypes, recordMarketCost } from "@/lib/market-costs";

export const dynamic = "force-dynamic";

/**
 * POST — dépense du marché : { costTypeId | newType, amountHT, tvaRate?, date?,
 * state: paid | due | planned, treasuryAccountId?, supplierId? | payee?, … }.
 */
export const POST = withAuth("purchases", "create", async (req: NextRequest, auth: TokenPayload, params) => {
  if (!authCan(auth, "contracts", "read")) return forbidden("Accès aux marchés requis.");
  await connectDB();
  if (!Types.ObjectId.isValid(params.id)) return notFound("Marché introuvable");
  const body = await req.json().catch(() => ({}));
  try {
    await costTypes(auth.tenantId); // hors transaction : les types d'office existent avant sa photographie.
    const { purchase, type } = await withTransaction(s => recordMarketCost(auth, params.id, body, s));
    await logAudit(auth, "CREATE", "purchases", { resourceId: String(purchase._id), after: { number: purchase.number, totalTTC: purchase.totalTTC, status: purchase.status }, metadata: { contract: params.id, costType: type.label } });
    return created({ _id: String(purchase._id), number: purchase.number, status: purchase.status });
  } catch (e) {
    if (e instanceof BusinessRuleError) return badRequest(e.message);
    throw e;
  }
});
