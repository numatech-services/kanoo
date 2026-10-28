import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { isId, ownDesk } from "@/lib/comptoir";
import { DeskScheduleModel } from "@/models/DeskSchedule";
import { DEFAULT_SERVICES, PERIOD_KINDS, validateSchedule, type Schedule } from "@/lib/campus";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET ?deskId= — emploi du temps du campus (services, cours, périodes) ; services par défaut s'il est vide. */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const deskId = new URL(req.url).searchParams.get("deskId");
  if (!isId(deskId)) return badRequest("Comptoir invalide");
  if (!(await ownDesk(auth, deskId))) return notFound("Comptoir introuvable");
  const s = await DeskScheduleModel.findOne({ ...tenantFilter(auth), deskId: new Types.ObjectId(deskId) }).lean<(Schedule & { updatedAt?: Date }) | null>();
  return ok({
    services: s?.services?.length ? s.services : DEFAULT_SERVICES,
    courses: s?.courses ?? [], periods: s?.periods ?? [], safetyMargin: s?.safetyMargin ?? 0.1,
    updatedAt: s?.updatedAt ?? null, periodKinds: PERIOD_KINDS,
  });
});

/** PUT { deskId, services, courses, periods, safetyMargin } — enregistre l'emploi du temps (validé). */
export const PUT = withAuth("comptoir", "update", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  if (!(await ownDesk(auth, body.deskId))) return notFound("Comptoir introuvable");
  const s: Schedule = {
    services: (Array.isArray(body.services) ? body.services : DEFAULT_SERVICES).map((v: Record<string, unknown>) => ({
      key: String(v.key ?? "").slice(0, 20), label: String(v.label ?? "").trim().slice(0, 40), from: String(v.from ?? ""), to: String(v.to ?? ""), base: Math.round(Number(v.base) || 0) })),
    courses: (Array.isArray(body.courses) ? body.courses : []).map((c: Record<string, unknown>) => ({
      day: Number(c.day), from: String(c.from ?? ""), to: String(c.to ?? ""), group: String(c.group ?? "").trim().slice(0, 60), headcount: Math.round(Number(c.headcount) || 0),
      ...(c.start ? { start: String(c.start) } : {}), ...(c.end ? { end: String(c.end) } : {}), ...(c.label ? { label: String(c.label).slice(0, 120) } : {}) })),
    periods: (Array.isArray(body.periods) ? body.periods : []).map((p: Record<string, unknown>) => ({
      from: String(p.from ?? ""), to: String(p.to ?? ""), label: String(p.label ?? "").trim().slice(0, 80),
      kind: (String(p.kind) in PERIOD_KINDS ? String(p.kind) : "other") as Schedule["periods"][number]["kind"], factor: Number(p.factor) })),
    safetyMargin: body.safetyMargin === undefined ? 0.1 : Number(body.safetyMargin),
  };
  const err = validateSchedule(s);
  if (err) return badRequest(err);
  await DeskScheduleModel.updateOne({ ...tenantFilter(auth), deskId: new Types.ObjectId(String(body.deskId)) },
    { $set: { ...s, updatedBy: auth.userId }, $setOnInsert: { tenantId: auth.tenantId, deskId: body.deskId } }, { upsert: true });
  await logAudit(auth, "UPDATE", "comptoir", { metadata: { schedule: { courses: s.courses.length, periods: s.periods.length } } });
  return ok({ saved: true, courses: s.courses.length, periods: s.periods.length });
});
