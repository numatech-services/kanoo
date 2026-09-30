import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { LeaveModel } from "@/models/Leave";
import { EmployeeModel } from "@/models/Employee";
import { expenseAuthority } from "@/lib/expense-scope";
import { ownEmployee, scopeEmployees } from "@/lib/leave-scope";
import { workingDays, leaveBalance, LEAVE_TYPES } from "@/lib/leaves";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * GET /api/leaves?employeeId=&status=&year=&scope=mine|team
 * Mes demandes, celles de mon équipe (chef) ou de tous (gérant, Administration).
 */
export const GET = withAuth("leaves", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const allowed = await scopeEmployees(auth);
  const own = await ownEmployee(auth);
  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  const scope = url.searchParams.get("scope");
  const emp = url.searchParams.get("employeeId");
  if (scope === "mine") filter.employeeId = own?._id ?? new Types.ObjectId();
  else if (emp && Types.ObjectId.isValid(emp)) {
    if (allowed && !allowed.includes(emp)) return ok({ items: [], balance: null });
    filter.employeeId = new Types.ObjectId(emp);
  } else if (allowed) filter.employeeId = { $in: allowed.map(id => new Types.ObjectId(id)) };
  const status = url.searchParams.get("status");
  if (status) filter.status = status;
  const year = Number(url.searchParams.get("year"));
  if (year) filter.startDate = { $gte: new Date(year, 0, 1), $lt: new Date(year + 1, 0, 1) };

  const items = await LeaveModel.find(filter).sort({ startDate: -1 }).limit(500)
    .populate("employeeId", "firstName lastName code").populate("decidedBy", "firstName lastName").lean();
  const target = filter.employeeId instanceof Types.ObjectId
    ? await EmployeeModel.findOne({ _id: filter.employeeId, tenantId: auth.tenantId }).select("_id startDate leaveOpeningBalance").lean<{ _id: unknown; startDate: Date; leaveOpeningBalance?: number } | null>()
    : own;
  return ok({
    items,
    balance: target ? await leaveBalance(auth.tenantId, target) : null,
    canDecide: expenseAuthority(auth, "leaves").kind !== "own",
    ownEmployeeId: own ? String(own._id) : null,
    types: LEAVE_TYPES,
  });
});

/** POST — demande de congé (pour soi ; pour un autre salarié : Administration / gérant / chef). */
export const POST = withAuth("leaves", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const own = await ownEmployee(auth);
  const employeeId = body.employeeId ? String(body.employeeId) : own ? String(own._id) : "";
  if (!employeeId || !Types.ObjectId.isValid(employeeId)) {
    return badRequest("Aucune fiche salarié n'est rattachée à votre compte : demandez à l'Administration de faire le lien.");
  }
  if (!own || employeeId !== String(own._id)) {
    const allowed = await scopeEmployees(auth);
    if (allowed && !allowed.includes(employeeId)) return badRequest("Vous ne pouvez saisir un congé que pour vous ou votre équipe.");
  }
  const employee = await EmployeeModel.findOne({ _id: employeeId, tenantId: auth.tenantId, isActive: true }).select("_id startDate leaveOpeningBalance").lean<{ _id: unknown; startDate: Date; leaveOpeningBalance?: number } | null>();
  if (!employee) return badRequest("Salarié introuvable ou inactif.");
  const type = String(body.type ?? "annual");
  if (!(type in LEAVE_TYPES)) return badRequest("Type de congé inconnu.");
  const start = new Date(body.startDate), end = new Date(body.endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return badRequest("Dates invalides.");
  if (end < start) return badRequest("La fin précède le début.");
  const days = workingDays(start, end, !!body.halfDayStart, !!body.halfDayEnd);
  if (days <= 0) return badRequest("Aucun jour ouvrable dans cette période.");
  const overlap = await LeaveModel.exists({ tenantId: auth.tenantId, employeeId, status: { $in: ["pending", "approved"] }, startDate: { $lte: end }, endDate: { $gte: start } });
  if (overlap) return badRequest("Une autre demande couvre déjà une partie de ces dates.");
  if (type === "annual") {
    const bal = await leaveBalance(auth.tenantId, employee);
    if (days > bal.available && !body.allowNegative) return badRequest(`Solde insuffisant : ${bal.available} jour(s) disponible(s), ${days} demandé(s).`);
  }
  const leave = await LeaveModel.create({
    tenantId: auth.tenantId, employeeId, type, startDate: start, endDate: end, days,
    halfDayStart: !!body.halfDayStart, halfDayEnd: !!body.halfDayEnd,
    reason: body.reason ? String(body.reason).slice(0, 500) : undefined, status: "pending", createdBy: auth.userId,
  });
  await logAudit(auth, "CREATE", "leaves", { resourceId: String(leave._id), after: { employeeId, type, days } });
  return created(leave);
});
