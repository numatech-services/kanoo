import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, created, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { isId, ownDesk } from "@/lib/comptoir";
import { closeDay, dayFigures } from "@/lib/comptoir-sale";
import { CashClosingModel } from "@/models/CashClosing";
import { hasFinanceAccess } from "@/lib/role-resources";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Arrêtés de caisse d'un comptoir. `day=AAAA-MM-JJ` renvoie en plus les
 * chiffres théoriques de cette journée (par moyen) et son arrêté s'il existe.
 */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const deskId = url.searchParams.get("deskId");
  if (!isId(deskId)) return badRequest("Comptoir invalide");
  if (!(await ownDesk(auth, deskId))) return notFound("Comptoir introuvable");
  const day = url.searchParams.get("day");
  const finance = hasFinanceAccess(auth);
  const strip = <T extends Record<string, unknown>>(c: T) => (finance ? c : { ...c, marginHT: undefined });
  const items = await CashClosingModel.find({ ...tenantFilter(auth), deskId: new Types.ObjectId(deskId) })
    .populate("closedBy", "firstName lastName").sort({ day: -1 }).limit(90).lean<Array<Record<string, unknown>>>();
  const last = items[0]?.day as string | undefined;
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const figures = await dayFigures(auth.tenantId, deskId, day);
    return ok({
      items: items.map(strip), lastClosedDay: last ?? null,
      day: { ...strip(figures), closing: items.find(c => c.day === day) ?? null, locked: !!last && last >= day },
    });
  }
  return ok({ items: items.map(strip), lastClosedDay: last ?? null });
});

/** Arrête la journée : écart comptabilisé, journée verrouillée. */
export const POST = withAuth("comptoir", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  if (!(await ownDesk(auth, body.deskId))) return notFound("Comptoir introuvable");
  if (body.countedCash === undefined || body.countedCash === null || body.countedCash === "") return badRequest("Saisissez les espèces comptées.");
  const closing = await withTransaction(session => closeDay(auth, body, session));
  await logAudit(auth, "CREATE", "comptoir", { resourceId: String(closing._id), metadata: { closing: closing.day, gap: closing.gap } });
  return created(closing);
});
