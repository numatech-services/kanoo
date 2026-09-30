import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, created, badRequest, notFound, conflict, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { PayslipModel } from "@/models/Payslip";
import { EmployeeModel } from "@/models/Employee";
import { withTransaction } from "@/lib/db";
import { generatePayslip, PayrollError, type PayrollEmployee } from "@/lib/payroll-run";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("payslips", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const employeeId = url.searchParams.get("employeeId");
  const year = url.searchParams.get("year");
  const month = url.searchParams.get("month");

  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  if (employeeId) filter.employeeId = employeeId;
  if (year) filter.year = parseInt(year);
  if (month) filter.month = parseInt(month);

  const [items, total] = await Promise.all([
    PayslipModel.find(filter)
      .populate("employeeId", "firstName lastName code position")
      .sort({ year: -1, month: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    PayslipModel.countDocuments(filter),
  ]);
  return paginatedResponse(items, total, pagination);
});

// POST — Générer un bulletin de paie (réglages lus sur la fiche du salarié).
export const POST = withAuth("payslips", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json();
  const missing = requireFields(body, ["employeeId", "month", "year"]);
  if (missing) return badRequest(missing);

  await connectDB();
  const employee = await EmployeeModel.findOne({ _id: body.employeeId, tenantId: auth.tenantId, isActive: true })
    .lean<PayrollEmployee | null>();
  if (!employee) return notFound("Employé introuvable ou inactif");

  try {
    const result = await withTransaction(session => generatePayslip(auth, employee, {
      month: Number(body.month), year: Number(body.year),
      grossSalary: body.grossSalary, units: body.units,
      includeSeniority: body.includeSeniority, items: body.items ?? body.manualItems,
    }, session));
    await logAudit(auth, "CREATE", "payslips", {
      resourceId: result.payslip._id.toString(),
      after: { employeeId: body.employeeId, month: result.payslip.month, year: result.payslip.year, netSalary: result.payslip.netSalary },
    });
    // Les alertes (SMIG non respecté, net négatif) accompagnent le bulletin.
    return created({ ...result.payslip.toJSON(), alerts: result.alerts });
  } catch (e) {
    if (e instanceof PayrollError) return /déjà généré/.test(e.message) ? conflict(e.message) : badRequest(e.message);
    throw e;
  }
});
