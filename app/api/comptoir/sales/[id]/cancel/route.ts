import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { isId, deskFilter } from "@/lib/comptoir";
import { cancelSale } from "@/lib/comptoir-sale";
import { ComptoirSaleModel } from "@/models/ComptoirSale";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Annulation motivée d'un ticket : stock rendu, encaissements retirés, écriture extournée. */
export const POST = withAuth("comptoir", "delete", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!isId(params.id)) return notFound("Ticket introuvable");
  const body = await req.json().catch(() => ({}));
  const reason = String(body.reason ?? "").trim();
  if (reason.length < 3) return badRequest("Motif d'annulation obligatoire.");
  if (!(await ComptoirSaleModel.exists({ _id: params.id, ...tenantFilter(auth), ...deskFilter(auth) }))) return notFound("Ticket introuvable");
  const sale = await withTransaction(session => cancelSale(auth, params.id, reason, session));
  await logAudit(auth, "DELETE", "comptoir", { resourceId: String(sale._id), before: { sale: sale.number, total: sale.totalTTC }, metadata: { reason } });
  return ok({ cancelled: true, number: sale.number });
});
