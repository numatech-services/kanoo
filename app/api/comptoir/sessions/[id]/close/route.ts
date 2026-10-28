import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { isId, deskFilter } from "@/lib/comptoir";
import { CashSessionModel } from "@/models/CashSession";
import { closeSession } from "@/lib/comptoir-session";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

/** POST { countedCash, notes? } — ferme la caisse : comptage, écart comptabilisé, période verrouillée. */
export const POST = withAuth("comptoir", "create", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!isId(params.id)) return notFound("Caisse introuvable");
  if (!(await CashSessionModel.exists({ _id: params.id, ...tenantFilter(auth), ...deskFilter(auth) }))) return notFound("Caisse introuvable");
  const body = await req.json().catch(() => ({}));
  if (body.countedCash === undefined || body.countedCash === null || body.countedCash === "") return badRequest("Saisissez les espèces comptées.");
  const closed = await withTransaction(session => closeSession(auth, params.id, { countedCash: Number(body.countedCash), notes: body.notes ? String(body.notes) : undefined }, session));
  await logAudit(auth, "UPDATE", "comptoir", { resourceId: params.id, metadata: { cashSession: "close", counted: body.countedCash } });
  return ok(closed);
});
