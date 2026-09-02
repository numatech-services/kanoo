import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, created, badRequest, notFound, conflict, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { PayslipModel } from "@/models/Payslip";
import { EmployeeModel } from "@/models/Employee";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { withTransaction } from "@/lib/db";
import { calculerBulletinDePaie } from "@/lib/payslip-calc";
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
    month: Number(body.month),
    year: Number(body.year),
  });
  if (existing) return conflict(`Bulletin déjà généré pour ${body.month}/${body.year}`);

  const month = Number(body.month);
  const year = Number(body.year);
  if (!Number.isInteger(month) || month < 1 || month > 12) return badRequest("Mois invalide");
  if (!Number.isInteger(year) || year < 2000) return badRequest("Année invalide");

  // Fin de la période : c'est à cette date que l'ancienneté s'apprécie, pas au
  // jour de génération — sans quoi rééditer un bulletin en changerait le montant.
  const periodEnd = new Date(year, month, 0);

  // Un seul moteur de paie. La route calculait auparavant un net « brut − CNSS »
  // de son côté, sans IR ni prime d'ancienneté, pendant que lib/payslip-calc.ts
  // — testé — restait inutilisé : l'impôt n'était jamais retenu.
  const payroll = calculerBulletinDePaie({
    grossSalary: body.grossSalary ?? employee.grossSalary,
    startDate: employee.startDate,
    employeeType: employee.employeeType ?? "employee",
    indemnity: body.indemnity,
    includeCnss: body.includeCnss ?? true,
    includeIr: body.includeIr ?? true,
    includeSeniority: body.includeSeniority ?? true,
    manualItems: body.manualItems,
    periodEnd,
  });

  const otherDeductions = payroll.totalManualDeductions;
  const netSalary = payroll.netAPayer;

  const result = await withTransaction(async (session) => {
    // 1. Créer le bulletin
    const [payslip] = await PayslipModel.create(
      [{
        tenantId: auth.tenantId,
        employeeId: body.employeeId,
        month,
        year,
        grossSalary: payroll.grossSalary,
        grossTotal: payroll.grossTotal,
        seniorityRate: payroll.seniority.taux,
        seniorityAmount: payroll.seniority.montant,
        cnssEmployee: payroll.cnssEmployee,
        cnssEmployer: payroll.cnssEmployer,
        incomeTax: payroll.ir,
        otherDeductions,
        netSalary,
        employerCost: payroll.totalEmployerCost,
        isPaid: false,
      }],
      { session }
    );

    // 2. Écriture comptable OD — Charges de personnel.
    // L'équilibre est vérifié explicitement : l'ancienne écriture omettait la
    // contrepartie des retenues diverses et de l'IR, et se retrouvait
    // déséquilibrée du montant de ces retenues.
    const entryLines = [
      { accountCode: "661000", accountLabel: "Salaires bruts", debit: payroll.grossTotal, credit: 0 },
      { accountCode: "664000", accountLabel: "Charges sociales patronales (CNSS)", debit: payroll.cnssEmployer, credit: 0 },
      { accountCode: "431000", accountLabel: "CNSS salariale à payer", debit: 0, credit: payroll.cnssEmployee },
      { accountCode: "431100", accountLabel: "CNSS patronale à payer", debit: 0, credit: payroll.cnssEmployer },
      ...(payroll.ir > 0
        ? [{ accountCode: "447100", accountLabel: "IR sur salaires à reverser", debit: 0, credit: payroll.ir }]
        : []),
      ...(otherDeductions > 0
        ? [{ accountCode: "427000", accountLabel: "Retenues sur salaires", debit: 0, credit: otherDeductions }]
        : []),
      { accountCode: "421000", accountLabel: "Rémunérations dues", debit: 0, credit: netSalary },
    ];

    const totalDebit = entryLines.reduce((sum, l) => sum + l.debit, 0);
    const totalCredit = entryLines.reduce((sum, l) => sum + l.credit, 0);
    if (totalDebit !== totalCredit) {
      throw new Error(
        `Écriture de paie déséquilibrée (débit ${totalDebit} ≠ crédit ${totalCredit}) — bulletin non enregistré.`
      );
    }

    await AccountingEntryModel.create(
      [{
        tenantId: auth.tenantId,
        journalCode: "OD",
        entryDate: periodEnd,
        reference: `PAIE-${year}${String(month).padStart(2, "0")}-${employee.code}`,
        label: `Paie ${employee.firstName} ${employee.lastName} — ${month}/${year}`,
        lines: entryLines,
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
    after: {
      employeeId: body.employeeId, month, year,
      netSalary: result.netSalary, incomeTax: result.incomeTax,
    },
  });

  // Les alertes (SMIG non respecté, net négatif) accompagnent le bulletin :
  // elles doivent atteindre le gestionnaire de paie, pas rester dans le calcul.
  return created({ ...result.toJSON(), alerts: payroll.alerts });
});
