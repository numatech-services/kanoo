import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { isId, ownDesk, canSeeDeskCosts } from "@/lib/comptoir";
import { CashSessionModel } from "@/models/CashSession";
import { periodReport, openSession } from "@/lib/comptoir-session";
import { localDay } from "@/lib/comptoir-sale";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import "@/models/User";

export const dynamic = "force-dynamic";

type Report = Awaited<ReturnType<typeof periodReport>>;
/** Sans droit aux coûts : chiffre d'affaires et caisse, sans coût ni marge. */
function strip(r: Report | Record<string, unknown> | null | undefined, costs: boolean) {
  if (!r || costs) return r;
  const x = r as Report;
  const lite = (p: Report["topByRevenue"][number]) => ({ itemId: p.itemId, label: p.label, category: p.category, quantity: p.quantity, revenueTTC: p.revenueTTC, tickets: p.tickets });
  return { ...x, sales: { ...x.sales, cost: undefined, margin: undefined, markupRate: undefined }, byDay: x.byDay?.map(d => ({ ...d, margin: undefined })),
    topByRevenue: x.topByRevenue?.map(lite), topByQuantity: x.topByQuantity?.map(lite), topByMargin: [], losses: [] };
}

/**
 * GET ?deskId= — caisse ouverte du comptoir (avec son bilan en direct et la
 * comparaison à la période précédente) et historique des périodes fermées.
 */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const deskId = new URL(req.url).searchParams.get("deskId");
  if (!isId(deskId)) return badRequest("Comptoir invalide");
  if (!(await ownDesk(auth, deskId))) return notFound("Comptoir introuvable");
  const costs = canSeeDeskCosts(auth);
  const [current, history] = await Promise.all([
    CashSessionModel.findOne({ ...tenantFilter(auth), deskId: new Types.ObjectId(deskId), status: "open" }).populate("openedBy", "firstName lastName").lean<Record<string, unknown> & { openDay: string; openingFloat: number } | null>(),
    CashSessionModel.find({ ...tenantFilter(auth), deskId: new Types.ObjectId(deskId), status: "closed" }).sort({ openDay: -1 }).limit(26)
      .populate("openedBy closedBy", "firstName lastName").lean<Array<Record<string, unknown> & { summary?: Report }>>(),
  ]);
  const live = current ? await periodReport(auth.tenantId, deskId, current.openDay, localDay(new Date()), current.openingFloat) : null;
  return ok({
    showCosts: costs,
    current: current ? { ...current, report: strip(live, costs) } : null,
    previous: history[0] ? strip(history[0].summary, costs) : null,
    history: history.map(h => ({ ...h, summary: strip(h.summary, costs) })),
  });
});

/** POST { deskId, openingFloat, day?, label? } — ouvre la caisse (la semaine). */
export const POST = withAuth("comptoir", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  if (!(await ownDesk(auth, body.deskId))) return notFound("Comptoir introuvable");
  const s = await openSession(auth, { deskId: String(body.deskId), openingFloat: Number(body.openingFloat ?? 0), day: body.day, label: body.label ? String(body.label) : undefined });
  await logAudit(auth, "CREATE", "comptoir", { resourceId: String(s._id), metadata: { cashSession: "open", float: s.openingFloat } });
  return created(s);
});
