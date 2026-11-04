import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, forbidden } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { isId, ownDesk, canSeeDeskCosts } from "@/lib/comptoir";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { weekStatus, closeWeek, reopenWeek, setGapThreshold } from "@/lib/restaurant-week";

export const dynamic = "force-dynamic";

/** GET ?deskId= — où en est la semaine du site. */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const deskId = new URL(req.url).searchParams.get("deskId");
  if (!isId(deskId) || !(await ownDesk(auth, deskId))) return notFound("Site introuvable");
  return ok(await weekStatus(auth.tenantId, deskId));
});

/** POST { deskId, action: "close", note? } · { action: "reopen", weekEnd, reason } · { action: "threshold", value } — chef, direction, comptabilité. */
export const POST = withAuth("comptoir", "update", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  if (!isId(body.deskId) || !(await ownDesk(auth, body.deskId))) return notFound("Site introuvable");
  if (!canSeeDeskCosts(auth)) return forbidden("La clôture de semaine revient au chef du site, à la direction et à la comptabilité.");
  try {
    if (body.action === "close") {
      const r = await closeWeek(auth, body.deskId, undefined, typeof body.note === "string" ? body.note : undefined);
      await logAudit(auth, "UPDATE", "comptoir", { resourceId: body.deskId, metadata: { weekClosed: r.weekEnd, ...r.summary } });
      return ok(r);
    }
    if (body.action === "reopen") {
      await reopenWeek(auth, body.deskId, String(body.weekEnd ?? ""), body.reason);
      await logAudit(auth, "UPDATE", "comptoir", { resourceId: body.deskId, metadata: { weekReopened: body.weekEnd, reason: body.reason } });
      return ok({ reopened: true });
    }
    if (body.action === "threshold") {
      await setGapThreshold(auth, body.deskId, body.value === null || body.value === "" ? null : Number(body.value));
      return ok({ saved: true });
    }
    return badRequest("Action inconnue (close, reopen, threshold).");
  } catch (e) { if (e instanceof BusinessRuleError) return badRequest(e.message); throw e; }
});
