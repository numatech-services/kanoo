import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { ProjectModel } from "@/models/Project";
import { TimeEntryModel } from "@/models/TimeEntry";
import { EmployeeModel } from "@/models/Employee";
import { projectScope } from "@/lib/project-scope";
import { hasFinanceAccess, authCan } from "@/lib/role-resources";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import "@/models/User";

export const dynamic = "force-dynamic";

/** Heures mensuelles légales (40 h × 52 / 12) : base du coût horaire d'un salarié. */
const MONTHLY_HOURS = 173.33;

async function visibleProject(auth: TokenPayload, id: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  return ProjectModel.findOne({ _id: id, ...tenantFilter(auth), ...projectScope(auth) }).select("_id tasks").lean<{ _id: Types.ObjectId; tasks?: Array<{ _id: Types.ObjectId }> } | null>();
}

/**
 * GET — temps passés sur le projet : lignes, total par personne et, pour la
 * direction et la comptabilité, coût estimé (salaire de base ÷ 173,33 h).
 */
export const GET = withAuth("projects", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const project = await visibleProject(auth, params.id);
  if (!project) return notFound("Projet introuvable");
  const items = await TimeEntryModel.find({ tenantId: auth.tenantId, projectId: project._id })
    .populate("userId", "firstName lastName").sort({ date: -1, createdAt: -1 }).limit(500)
    .lean<Array<{ _id: Types.ObjectId; userId?: { _id: Types.ObjectId; firstName?: string; lastName?: string }; hours: number; date: Date; note?: string; taskId?: Types.ObjectId; billable?: boolean }>>();
  const finance = hasFinanceAccess(auth);
  const rates = new Map<string, number>();
  if (finance) {
    const emps = await EmployeeModel.find({ tenantId: auth.tenantId, userId: { $in: [...new Set(items.map(i => i.userId?._id).filter(Boolean))] } })
      .select("userId grossSalary employeeType indemnity").lean<Array<{ userId: Types.ObjectId; grossSalary?: number; employeeType?: string; indemnity?: number }>>();
    for (const e of emps) rates.set(String(e.userId), Math.round(((e.employeeType === "employee" || !e.employeeType ? e.grossSalary : e.indemnity) ?? 0) / MONTHLY_HOURS));
  }
  const byPerson = new Map<string, { name: string; hours: number; cost: number | null }>();
  for (const i of items) {
    const k = String(i.userId?._id ?? "—");
    const cur = byPerson.get(k) ?? { name: `${i.userId?.firstName ?? ""} ${i.userId?.lastName ?? ""}`.trim() || "—", hours: 0, cost: finance ? 0 : null };
    cur.hours += i.hours;
    if (cur.cost !== null) cur.cost += Math.round(i.hours * (rates.get(k) ?? 0));
    byPerson.set(k, cur);
  }
  const people = [...byPerson.values()].sort((a, b) => b.hours - a.hours);
  return ok({
    items, people,
    totalHours: Math.round(items.reduce((t, i) => t + i.hours, 0) * 100) / 100,
    ...(finance ? { estimatedCost: people.reduce((t, p) => t + (p.cost ?? 0), 0) } : {}),
  });
});

/** POST { date, hours, note?, taskId?, billable?, userId? } — saisie d'un temps (le sien ; celui d'un autre pour un chef). */
export const POST = withAuth("projects", "read", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const project = await visibleProject(auth, params.id);
  if (!project) return notFound("Projet introuvable");
  const body = await req.json().catch(() => ({}));
  const hours = Math.round(Number(body.hours) * 4) / 4;
  if (!(hours >= 0.25 && hours <= 24)) return badRequest("Durée invalide (0,25 à 24 h).");
  const date = body.date ? new Date(body.date) : new Date();
  if (isNaN(date.getTime())) return badRequest("Date invalide.");
  const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
  if (date > endOfToday) return badRequest("On ne saisit pas un temps à venir.");
  if (body.taskId && !project.tasks?.some(t => String(t._id) === String(body.taskId))) return badRequest("Tâche inconnue sur ce projet.");
  // Saisir le temps d'un autre : réservé à qui peut modifier le projet.
  const userId = body.userId && String(body.userId) !== auth.userId ? String(body.userId) : auth.userId;
  if (userId !== auth.userId && !authCan(auth, "projects", "update")) return badRequest("Vous ne pouvez saisir que votre propre temps.");
  if (!Types.ObjectId.isValid(userId)) return badRequest("Personne invalide.");
  const entry = await TimeEntryModel.create({
    tenantId: auth.tenantId, projectId: project._id, userId, date, hours,
    ...(body.taskId ? { taskId: body.taskId } : {}), note: body.note ? String(body.note).slice(0, 300) : undefined,
    billable: body.billable !== false, createdBy: auth.userId,
  });
  await logAudit(auth, "CREATE", "projects", { resourceId: params.id, metadata: { time: hours, userId } });
  return created(entry);
});
