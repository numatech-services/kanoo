import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, created, badRequest, notFound } from "@/lib/api-helpers";
import { isId, ownDesk, canSeeDeskCosts } from "@/lib/comptoir";
import { recordLoss, lossesReport } from "@/lib/spot-server";
import { localDay } from "@/lib/comptoir-sale";
import { LOSS_REASONS } from "@/lib/spot";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET ?deskId=&from=&to= — pertes de la période par motif et par article (valeur au coût). */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const deskId = url.searchParams.get("deskId");
  if (!isId(deskId)) return badRequest("Comptoir invalide");
  if (!(await ownDesk(auth, deskId))) return notFound("Comptoir introuvable");
  const now = new Date();
  const from = url.searchParams.get("from") ?? localDay(new Date(now.getFullYear(), now.getMonth(), 1));
  const to = url.searchParams.get("to") ?? localDay(now);
  const r = await lossesReport(auth.tenantId, deskId, from, to);
  // Valeurs au coût : réservées à qui voit les coûts.
  return ok({ reasons: LOSS_REASONS, ...(canSeeDeskCosts(auth) ? r : { byReason: r.byReason.map(x => ({ ...x, value: undefined })), byItem: r.byItem.map(x => ({ ...x, value: undefined })) }) });
});

/** POST { deskId, itemId, quantity, reason, note? } — déclare une perte (cassé, périmé, offert, personnel…). */
export const POST = withAuth("comptoir", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  if (!(await ownDesk(auth, body.deskId))) return notFound("Comptoir introuvable");
  const r = await withTransaction(session => recordLoss(auth, body, session));
  await logAudit(auth, "CREATE", "comptoir", { resourceId: String(r.move._id), metadata: { loss: body.reason, quantity: body.quantity, value: r.lossValue } });
  return created({ move: r.move, lossValue: canSeeDeskCosts(auth) ? r.lossValue : undefined });
});
