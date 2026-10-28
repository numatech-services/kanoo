import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, created, badRequest, notFound } from "@/lib/api-helpers";
import { isId, ownDesk, canSeeDeskCosts } from "@/lib/comptoir";
import { cycleCountPlan, recordCounts } from "@/lib/spot-server";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET ?deskId= — articles à compter aujourd'hui (quantité théorique masquée : on compte sans la connaître). */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const deskId = new URL(req.url).searchParams.get("deskId");
  if (!isId(deskId)) return badRequest("Comptoir invalide");
  if (!(await ownDesk(auth, deskId))) return notFound("Comptoir introuvable");
  const plan = await cycleCountPlan(auth.tenantId, deskId);
  const costs = canSeeDeskCosts(auth);
  return ok({ ...plan, items: plan.items.map(i => ({ ...i, counted: i.counted ? { ...i.counted, gapValue: costs ? i.counted.gapValue : undefined } : null })) });
});

/** POST { deskId, counts: [{ itemId, counted }] } — comptages du jour : écarts enregistrés, stock aligné. */
export const POST = withAuth("comptoir", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  if (!(await ownDesk(auth, body.deskId))) return notFound("Comptoir introuvable");
  if (!Array.isArray(body.counts) || !body.counts.length) return badRequest("Aucun comptage.");
  const r = await withTransaction(session => recordCounts(auth, String(body.deskId), body.counts, session));
  await logAudit(auth, "CREATE", "comptoir", { metadata: { cycleCount: r.length, gaps: r.filter(x => x.gap !== 0).length } });
  const costs = canSeeDeskCosts(auth);
  return created({ results: r.map(x => ({ ...x, gapValue: costs ? x.gapValue : undefined })) });
});
