import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { authCan } from "@/lib/role-resources";
import { isId, ownDesk } from "@/lib/comptoir";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { isMonth } from "@/lib/restaurant";
import { weekPlanning, monthLabor, upsertShift, deleteShift, clock } from "@/lib/restaurant-staff";

export const dynamic = "force-dynamic";
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
/** Lundi de la semaine du jour donné. */
const monday = (day: string) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/**
 * GET ?deskId=&week=AAAA-MM-JJ — planning de la semaine (du lundi), et
 * &month=AAAA-MM — heures prévues et réelles du mois ; coût par service et
 * repas du personnel pour qui gère la paie.
 */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const deskId = url.searchParams.get("deskId");
  if (!isId(deskId) || !(await ownDesk(auth, deskId))) return notFound("Comptoir introuvable");
  const month = url.searchParams.get("month");
  if (month) {
    if (!isMonth(month)) return badRequest("Mois invalide (AAAA-MM).");
    return ok(await monthLabor(auth.tenantId, deskId, month, authCan(auth, "payslips", "read")));
  }
  const week = url.searchParams.get("week");
  const start = monday(isDay(week) ? week : new Date().toISOString().slice(0, 10));
  return ok(await weekPlanning(auth.tenantId, deskId, start));
});

/**
 * POST { deskId, action, … }
 *  - save : { employeeId, day, service, start, end, note? } — poste au planning ;
 *  - delete : { id } — retire un poste non pointé ;
 *  - in | out | absent : { id } — pointage.
 */
export const POST = withAuth("comptoir", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  if (!isId(body.deskId) || !(await ownDesk(auth, body.deskId))) return notFound("Comptoir introuvable");
  try {
    if (body.action === "save") {
      if (!isId(body.employeeId)) return badRequest("Collaborateur invalide.");
      await upsertShift(auth, body.deskId, { employeeId: body.employeeId, day: String(body.day), service: String(body.service), start: String(body.start), end: String(body.end), note: typeof body.note === "string" ? body.note : undefined });
      return ok({ saved: true });
    }
    if (!isId(body.id)) return badRequest("Poste invalide.");
    if (body.action === "delete") { await deleteShift(auth, body.deskId, body.id); return ok({ deleted: true }); }
    if (body.action === "in" || body.action === "out" || body.action === "absent") {
      await clock(auth, body.deskId, body.id, body.action);
      await logAudit(auth, "UPDATE", "comptoir", { resourceId: body.deskId, metadata: { clock: body.action, shift: body.id } });
      return ok({ clocked: body.action });
    }
    return badRequest("Action inconnue (save, delete, in, out, absent).");
  } catch (e) {
    if (e instanceof BusinessRuleError) return badRequest(e.message);
    throw e;
  }
});
