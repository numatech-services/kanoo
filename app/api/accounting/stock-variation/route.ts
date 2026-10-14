import { NextRequest } from "next/server";
import { withAuth, ok, created, badRequest } from "@/lib/api-helpers";
import { withTransaction } from "@/lib/db";
import { previewStockVariation, postStockVariation } from "@/lib/stock-variation";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

function endOfDay(raw: unknown): Date | null {
  const d = raw ? new Date(`${String(raw).slice(0, 10)}T23:59:59.999Z`) : null;
  return d && !isNaN(d.getTime()) ? d : null;
}

/** GET ?date=AAAA-MM-JJ — valeur du stock, solde du compte 31, variation à passer. */
export const GET = withAuth("accountingEntries", "read", async (req: NextRequest, auth: TokenPayload) => {
  const date = endOfDay(new URL(req.url).searchParams.get("date") || new Date().toISOString());
  if (!date) return badRequest("Date invalide.");
  return ok(await previewStockVariation(auth.tenantId, date));
});

/** POST { date } — passe l'écriture de variation de stock à cette date. */
export const POST = withAuth("accountingEntries", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json().catch(() => ({}));
  const date = endOfDay(body.date);
  if (!date) return badRequest("Date de clôture invalide.");
  try {
    const r = await withTransaction(session => postStockVariation({ tenantId: auth.tenantId, userId: auth.userId }, date, session));
    await logAudit(auth, "CREATE", "accountingEntries", { resourceId: String(r.entryId), after: { stockVariation: r.variation, date: body.date } });
    return created(r);
  } catch (e) {
    if (e instanceof BusinessRuleError) return badRequest(e.message);
    throw e;
  }
});
