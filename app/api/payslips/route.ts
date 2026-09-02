import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, notFound, conflict, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { PayslipModel } from "@/models/Payslip";
import { EmployeeModel } from "@/models/Employee";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { withTransaction } from "@/lib/db";
import { calculerCNSS } from "@/lib/niger-fiscal";
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

// POST — Générer un bulletin de paie
export const POST = withAuth("payslips", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json();
  const missing = requireFields(body, ["employeeId", "month", "year"]);
  if (missing) return badRequest(missing);

  await connectDB();

  const employee = await EmployeeModel.findOne({ _id: body.employeeId, tenantId: auth.tenantId, isActive: true });
  if (!employee) return notFound("Employé introuvable ou inactif");

  // Vérifier qu'il n'existe pas déjà
  const existing = await PayslipModel.findOne({
    tenantId: auth.tenantId,
    employeeId: body.employeeId,
    month: body.month,
    year: body.year,
  });
  if (existing) return conflict(`Bulletin déjà généré pour ${body.month}/${body.year}`);

  const grossSalary = body.grossSalary || employee.grossSalary;
  const cnss = calculerCNSS(grossSalary);
  const otherDeductions = body.otherDeductions || 0;
  const netSalary = grossSalary - cnss.salarie - otherDeductions;

  const result = await withTransaction(async (session) => {
    // 1. Créer le bulletin
    const [payslip] = await PayslipModel.create(
      [{
        tenantId: auth.tenantId,
        employeeId: body.employeeId,
        month: body.month,
        year: body.year,
        grossSalary,
        cnssEmployee: cnss.salarie,
        cnssEmployer: cnss.patronal,
        otherDeductions,
        netSalary: Math.round(netSalary),
        isPaid: false,
      }],
      { session }
    );

    // 2. Écriture comptable OD — Charges de personnel
    await AccountingEntryModel.create(
      [{
        tenantId: auth.tenantId,
        journalCode: "OD",
        entryDate: new Date(body.year, body.month - 1, 28),
        reference: `PAIE-${body.year}${String(body.month).padStart(2, "0")}-${employee.code}`,
        label: `Paie ${employee.firstName} ${employee.lastName} — ${body.month}/${body.year}`,
        lines: [
          { accountCode: "661000", accountLabel: "Salaires bruts", debit: grossSalary, credit: 0 },
          { accountCode: "664000", accountLabel: "Charges sociales patronales (CNSS)", debit: cnss.patronal, credit: 0 },
          { accountCode: "431000", accountLabel: "CNSS salariale à payer", debit: 0, credit: cnss.salarie },
          { accountCode: "431100", accountLabel: "CNSS patronale à payer", debit: 0, credit: cnss.patronal },
          { accountCode: "421000", accountLabel: "Rémunérations dues", debit: 0, credit: Math.round(netSalary) },
        ],
        linkedDocType: "payslip",
        linkedDocId: payslip._id,
        createdBy: auth.userId,
      }],
      { session }
    );

    return payslip;
  });

  await logAudit(auth, "CREATE", "payslips", {
    resourceId: result._id.toString(),
    after: { employeeId: body.employeeId, month: body.month, year: body.year, netSalary: Math.round(netSalary) },
  });

  return created(result);
});
