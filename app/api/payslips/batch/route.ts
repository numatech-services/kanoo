import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, badRequest } from "@/lib/api-helpers";
import { EmployeeModel } from "@/models/Employee";
import { PayslipModel } from "@/models/Payslip";
import { generatePayslip, PayrollError, type PayrollEmployee } from "@/lib/payroll-run";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

/**
 * POST /api/payslips/batch — { month, year, items?: { [employeeId]: [...] }, units?: { [employeeId]: n } }
 * Paie du mois : un bulletin par salarié actif qui n'en a pas encore. Chaque
 * bulletin a sa propre transaction : une fiche incomplète n'empêche pas les
 * autres, elle est listée dans `skipped` avec la raison.
 */
export const POST = withAuth("payslips", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json().catch(() => ({}));
  const month = Number(body.month), year = Number(body.year);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) return badRequest("Mois ou année invalide.");
  await connectDB();

  const periodEnd = new Date(year, month, 0);
  const employees = await EmployeeModel.find({ tenantId: auth.tenantId, isActive: true, startDate: { $lte: periodEnd } })
    .sort({ lastName: 1 }).lean<PayrollEmployee[]>();
  const done = new Set((await PayslipModel.find({ tenantId: auth.tenantId, month, year }).select("employeeId").lean<Array<{ employeeId: unknown }>>())
    .map(p => String(p.employeeId)));

  const createdList: Array<{ employeeId: string; name: string; netSalary: number; alerts: string[] }> = [];
  const skipped: Array<{ employeeId: string; name: string; reason: string }> = [];
  for (const e of employees) {
    const id = String(e._id), name = `${e.firstName} ${e.lastName}`;
    if (done.has(id)) { skipped.push({ employeeId: id, name, reason: "Bulletin déjà généré" }); continue; }
    try {
      const r = await withTransaction(session => generatePayslip(auth, e, {
        month, year, items: body.items?.[id], units: body.units?.[id],
      }, session));
      createdList.push({ employeeId: id, name, netSalary: r.payslip.netSalary, alerts: r.alerts });
    } catch (err) {
      if (!(err instanceof PayrollError)) throw err;
      skipped.push({ employeeId: id, name, reason: err.message });
    }
  }

  await logAudit(auth, "CREATE", "payslips", { metadata: { batch: `${month}/${year}`, created: createdList.length, skipped: skipped.length } });
  return ok({ month, year, created: createdList, skipped, totalNet: createdList.reduce((s, x) => s + x.netSalary, 0) });
});
