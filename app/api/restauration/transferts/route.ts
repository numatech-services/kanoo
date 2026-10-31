import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, notFound } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { isId, ownDesk, deskScope, canSeeDeskCosts } from "@/lib/comptoir";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { notifyRoles } from "@/lib/notify";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { sendTransfer, receiveTransfer, listTransfers, getTransfer } from "@/lib/restaurant-transfer";

export const dynamic = "force-dynamic";

/**
 * GET — bons de transfert des restaurants de l'appelant ; ?id= — un bon avec
 * ses signatures (impression) ; ?destinations=1 — noms de tous les
 * restaurants de l'organisation (destinataires possibles).
 */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url), id = url.searchParams.get("id");
  if (url.searchParams.get("destinations") === "1") return ok(await ActivityDeskModel.find({ tenantId: auth.tenantId, archived: { $ne: true } }).select("name").sort({ name: 1 }).lean());
  const costs = canSeeDeskCosts(auth);
  if (isId(id)) {
    const t = await getTransfer(auth.tenantId, id, costs);
    if (!t || (!(await ownDesk(auth, String(t.fromDeskId))) && !(await ownDesk(auth, String(t.toDeskId))))) return notFound("Bon introuvable");
    return ok(t);
  }
  return ok(await listTransfers(auth.tenantId, deskScope(auth), costs));
});

/**
 * POST { action: "send", fromDeskId, toDeskId, lines: [{ itemId, quantity | packs }], signerName, signature, note? }
 *    — envoi signé, de réserve à réserve ;
 * POST { action: "receive", id, signerName, signature, gapNote? } — réception signée par le destinataire.
 */
export const POST = withAuth("comptoir", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "send") {
      if (!isId(body.fromDeskId) || !(await ownDesk(auth, body.fromDeskId))) return notFound("Restaurant d'origine introuvable");
      if (!isId(body.toDeskId)) return badRequest("Restaurant destinataire invalide.");
      const lines = Array.isArray(body.lines) ? body.lines.filter((l: { itemId?: unknown }) => isId(l?.itemId)).slice(0, 100) : [];
      const r = await sendTransfer(auth, body.fromDeskId, body.toDeskId, lines, { name: body.signerName, signature: body.signature }, typeof body.note === "string" ? body.note : undefined);
      await logAudit(auth, "CREATE", "comptoir", { resourceId: body.fromDeskId, metadata: { transfer: r.number, to: body.toDeskId, lines: lines.length } });
      await notifyRoles(auth.tenantId, ["pme_manager", "pme_activity_manager", "svc_spot"], { type: "stock_alert", title: `Transfert ${r.number} à réceptionner`, message: "Marchandise envoyée par un autre restaurant : vérifiez et signez la réception (Restauration → Transferts).", linkedTo: "comptoir", linkedId: String(body.toDeskId) }).catch(() => undefined);
      return created(r);
    }
    if (body.action === "receive") {
      if (!isId(body.id)) return badRequest("Bon invalide.");
      await receiveTransfer(auth, body.id, async deskId => !!(await ownDesk(auth, deskId)), { name: body.signerName, signature: body.signature }, typeof body.gapNote === "string" ? body.gapNote : undefined);
      await logAudit(auth, "UPDATE", "comptoir", { resourceId: body.id, metadata: { transferReceived: body.id, gap: !!body.gapNote } });
      return ok({ received: true });
    }
    return badRequest("Action inconnue (send, receive).");
  } catch (e) {
    if (e instanceof BusinessRuleError) return badRequest(e.message);
    throw e;
  }
});
