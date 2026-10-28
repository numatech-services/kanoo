import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, notFound, tenantFilter } from "@/lib/api-helpers";
import { isId, deskFilter } from "@/lib/comptoir";
import { DeskCustomerModel } from "@/models/DeskCustomer";
import { settleCredit } from "@/lib/desk-credit";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

/** POST { amount, method?, date? } — règlement de l'ardoise (encaissement, écriture, solde réduit). */
export const POST = withAuth("comptoir", "create", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!isId(params.id) || !(await DeskCustomerModel.exists({ _id: params.id, ...tenantFilter(auth), ...deskFilter(auth) }))) return notFound("Client introuvable");
  const body = await req.json().catch(() => ({}));
  const r = await withTransaction(session => settleCredit(auth, params.id, body, session));
  await logAudit(auth, "CREATE", "comptoir", { resourceId: params.id, metadata: { creditSettled: body.amount, method: body.method } });
  return ok(r);
});
