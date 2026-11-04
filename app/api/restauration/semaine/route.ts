import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, forbidden } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { hasFinanceAccess } from "@/lib/role-resources";
import { isId, ownDesk, canSeeDeskCosts } from "@/lib/comptoir";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { weekStatus, closeWeek, reopenWeek, setGapThreshold } from "@/lib/restaurant-week";
import { depositCash } from "@/lib/restaurant-funding";
import { TreasuryAccountModel } from "@/models/TreasuryAccount";

export const dynamic = "force-dynamic";

/** GET ?deskId= — où en est la semaine du site. */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const deskId = new URL(req.url).searchParams.get("deskId");
  if (!isId(deskId) || !(await ownDesk(auth, deskId))) return notFound("Site introuvable");
  // Comptes qui peuvent recevoir une remise : seulement leurs noms, pour qui gère la caisse.
  const accounts = canSeeDeskCosts(auth) ? await TreasuryAccountModel.find({ tenantId: auth.tenantId, isActive: { $ne: false }, type: { $in: ["bank", "mobile_money"] } }).select("label").sort({ label: 1 }).lean() : [];
  return ok({ ...(await weekStatus(auth.tenantId, deskId)), canManage: hasFinanceAccess(auth), accounts });
});

/** POST { deskId, action: "close", day?, note? } (chef, direction, comptabilité) · { action: "reopen", weekEnd, reason } · { action: "threshold", value } (direction, comptabilité). */
export const POST = withAuth("comptoir", "update", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  if (!isId(body.deskId) || !(await ownDesk(auth, body.deskId))) return notFound("Site introuvable");
  if (!canSeeDeskCosts(auth)) return forbidden("La clôture de semaine revient au chef du site, à la direction et à la comptabilité.");
  try {
    if (body.action === "close") {
      const r = await closeWeek(auth, body.deskId, typeof body.day === "string" && body.day ? body.day : undefined, typeof body.note === "string" ? body.note : undefined);
      await logAudit(auth, "UPDATE", "comptoir", { resourceId: body.deskId, metadata: { weekClosed: r.weekEnd, ...r.summary } });
      return ok(r);
    }
    if (body.action === "deposit") {
      if (!hasFinanceAccess(auth) && !(isId(body.toAccountId) && await TreasuryAccountModel.exists({ _id: body.toAccountId, tenantId: auth.tenantId, type: { $in: ["bank", "mobile_money"] } }))) return badRequest("Une remise va vers la banque ou le mobile money.");
      const r = await depositCash(auth, body.deskId, { amount: Number(body.amount), toAccountId: String(body.toAccountId ?? "") });
      await logAudit(auth, "CREATE", "comptoir", { resourceId: body.deskId, metadata: { cashDeposit: body.amount } });
      return ok({ deposited: true, entryId: String(r.entryId) });
    }
    // Rouvrir une période et régler le seuil de contrôle : pas celui qui compte et valide.
    if (!hasFinanceAccess(auth)) return forbidden("La réouverture et le seuil reviennent à la direction et à la comptabilité.");
    if (body.action === "reopen") {
      await reopenWeek(auth, body.deskId, String(body.weekEnd ?? ""), body.reason);
      await logAudit(auth, "UPDATE", "comptoir", { resourceId: body.deskId, metadata: { weekReopened: body.weekEnd, reason: body.reason } });
      return ok({ reopened: true });
    }
    if (body.action === "threshold") {
      const value = body.value === null || body.value === "" ? null : Number(body.value);
      await setGapThreshold(auth, body.deskId, value);
      await logAudit(auth, "UPDATE", "comptoir", { resourceId: body.deskId, metadata: { gapThreshold: value } });
      return ok({ saved: true });
    }
    return badRequest("Action inconnue (close, reopen, threshold).");
  } catch (e) { if (e instanceof BusinessRuleError) return badRequest(e.message); throw e; }
});
