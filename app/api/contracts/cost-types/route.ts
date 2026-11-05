import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, forbidden } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { authCan } from "@/lib/role-resources";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { costTypes, createCostType } from "@/lib/market-costs";

export const dynamic = "force-dynamic";

/** GET — types de dépense des marchés de l'organisation. */
export const GET = withAuth("contracts", "read", async (_req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  return ok({ items: await costTypes(auth.tenantId) });
});

/** POST { label, accountCode, accountLabel? } — nouveau type, pour qui saisit les dépenses. */
export const POST = withAuth("contracts", "read", async (req: NextRequest, auth: TokenPayload) => {
  if (!authCan(auth, "purchases", "create")) return forbidden("Réservé à ceux qui saisissent les dépenses.");
  await connectDB();
  const body = await req.json().catch(() => ({}));
  try {
    await costTypes(auth.tenantId);
    const t = await createCostType(auth, body);
    await logAudit(auth, "CREATE", "contracts", { resourceId: String(t._id), metadata: { costType: t.label, accountCode: t.accountCode } });
    return created(t);
  } catch (e) {
    if (e instanceof BusinessRuleError) return badRequest(e.message);
    throw e;
  }
});
