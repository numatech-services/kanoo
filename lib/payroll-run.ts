import type { ClientSession } from "mongoose";
import { PayslipModel } from "@/models/Payslip";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { calculerBulletinDePaie, type ManualDeduction } from "@/lib/payslip-calc";
import type { TokenPayload } from "@/lib/auth";

/** Salarié tel que lu pour la paie. */
export interface PayrollEmployee {
  _id: unknown; code: string; firstName: string; lastName: string;
  employeeType?: "employee" | "intern" | "freelance";
  grossSalary?: number; indemnity?: number; indemnityPeriod?: string;
  includeCnss?: boolean; includeIr?: boolean;
  otherDeductionLabel?: string; otherDeductionAmount?: number;
  startDate: Date; department?: string; costCenter?: string;
}

export interface PayrollOptions {
  month: number; year: number;
  /** Surcharge ponctuelle du salaire de base (> 0 seulement ; 0 n'écrase rien). */
  grossSalary?: number;
  /** Jours ou heures du mois, pour une indemnité journalière / horaire. */
  units?: number;
  includeSeniority?: boolean;
  /** Primes (addition) et retenues (deduction) du mois, en plus de la retenue permanente de la fiche. */
  items?: ManualDeduction[];
}

export class PayrollError extends Error {}

export function cleanItems(raw: unknown): ManualDeduction[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((i: Record<string, unknown>) => ({
      label: String(i?.label ?? "").trim().slice(0, 120),
      amount: Math.round(Number(i?.amount)),
      type: i?.type === "deduction" ? "deduction" as const : "addition" as const,
    }))
    .filter(i => i.label && Number.isFinite(i.amount) && i.amount > 0);
}

/**
 * Calcule et enregistre le bulletin d'un salarié pour un mois, avec son
 * écriture OD, dans la transaction fournie. Source unique pour le bulletin
 * individuel et la paie groupée du mois.
 *
 * Les réglages viennent de la FICHE du salarié (CNSS, IR, indemnité, retenue
 * permanente) : l'écran envoyait « brut 0 » et le calcul se faisait sur zéro.
 */
export async function generatePayslip(auth: TokenPayload, employee: PayrollEmployee, opts: PayrollOptions, session?: ClientSession) {
  const { month, year } = opts;
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new PayrollError("Mois invalide");
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new PayrollError("Année invalide");

  const exists = await PayslipModel.exists({ tenantId: auth.tenantId, employeeId: employee._id, month, year }).session(session ?? null);
  if (exists) throw new PayrollError(`Bulletin déjà généré pour ${employee.firstName} ${employee.lastName} — ${month}/${year}`);

  const periodEnd = new Date(year, month, 0);
  const type = employee.employeeType ?? "employee";
  const base = Number(opts.grossSalary) > 0 ? Math.round(Number(opts.grossSalary)) : employee.grossSalary ?? 0;

  // Indemnité (stagiaire / freelance) : mensuelle ou forfaitaire telle quelle ;
  // journalière / horaire × nombre de jours / heures du mois.
  let indemnity = employee.indemnity ?? 0;
  if (type !== "employee" && (employee.indemnityPeriod === "daily" || employee.indemnityPeriod === "hourly")) {
    const units = Number(opts.units);
    if (!(units > 0)) throw new PayrollError(`Indiquez le nombre de ${employee.indemnityPeriod === "daily" ? "jours" : "heures"} pour ${employee.firstName} ${employee.lastName}.`);
    indemnity = Math.round(indemnity * units);
  }
  if (type === "employee" && !(base > 0)) throw new PayrollError(`Salaire de base non renseigné pour ${employee.firstName} ${employee.lastName}.`);
  if (type !== "employee" && !(indemnity > 0)) throw new PayrollError(`Indemnité non renseignée pour ${employee.firstName} ${employee.lastName}.`);

  const items = [...cleanItems(opts.items)];
  if ((employee.otherDeductionAmount ?? 0) > 0) {
    items.push({ label: employee.otherDeductionLabel || "Retenue", amount: employee.otherDeductionAmount!, type: "deduction" });
  }

  const payroll = calculerBulletinDePaie({
    grossSalary: base,
    startDate: employee.startDate,
    employeeType: type,
    indemnity,
    includeCnss: employee.includeCnss ?? true,
    includeIr: employee.includeIr ?? true,
    includeSeniority: opts.includeSeniority ?? true,
    manualItems: items,
    periodEnd,
  });

  const otherDeductions = payroll.totalManualDeductions;
  const netSalary = payroll.netAPayer;

  const [payslip] = await PayslipModel.create([{
    tenantId: auth.tenantId, employeeId: employee._id, month, year,
    grossSalary: payroll.grossSalary, grossTotal: payroll.grossTotal,
    seniorityRate: payroll.seniority.taux, seniorityAmount: payroll.seniority.montant,
    cnssEmployee: payroll.cnssEmployee, cnssEmployer: payroll.cnssEmployer,
    incomeTax: payroll.ir, otherDeductions, items, netImposable: payroll.netImposable,
    netSalary, employerCost: payroll.totalEmployerCost, isPaid: false,
  }], { session });

  // Écriture OD : charges de personnel. Stagiaires et freelances : indemnités /
  // honoraires, sans cotisations quand la fiche n'en prévoit pas.
  const chargeAccount = type === "employee"
    ? { accountCode: "661000", accountLabel: "Salaires bruts" }
    : type === "intern"
      ? { accountCode: "663800", accountLabel: "Indemnités de stage" }
      : { accountCode: "632400", accountLabel: "Honoraires" };
  const imput = employee.costCenter ? { costCenter: employee.costCenter } : {};
  const lines = [
    { ...chargeAccount, debit: payroll.grossTotal, credit: 0, ...imput },
    ...(payroll.cnssEmployer > 0 ? [{ accountCode: "664000", accountLabel: "Charges sociales patronales (CNSS)", debit: payroll.cnssEmployer, credit: 0, ...imput }] : []),
    ...(payroll.cnssEmployee > 0 ? [{ accountCode: "431000", accountLabel: "CNSS salariale à payer", debit: 0, credit: payroll.cnssEmployee }] : []),
    ...(payroll.cnssEmployer > 0 ? [{ accountCode: "431100", accountLabel: "CNSS patronale à payer", debit: 0, credit: payroll.cnssEmployer }] : []),
    ...(payroll.ir > 0 ? [{ accountCode: "447100", accountLabel: "IR sur salaires à reverser", debit: 0, credit: payroll.ir }] : []),
    ...(otherDeductions > 0 ? [{ accountCode: "427000", accountLabel: "Retenues sur salaires", debit: 0, credit: otherDeductions }] : []),
    { accountCode: "421000", accountLabel: "Rémunérations dues", debit: 0, credit: netSalary },
  ];
  const d = lines.reduce((s, l) => s + l.debit, 0), c = lines.reduce((s, l) => s + l.credit, 0);
  if (d !== c) throw new PayrollError(`Écriture de paie déséquilibrée (débit ${d} ≠ crédit ${c}) — bulletin non enregistré.`);

  const [entry] = await AccountingEntryModel.create([{
    tenantId: auth.tenantId, journalCode: "OD", entryDate: periodEnd,
    reference: `PAIE-${year}${String(month).padStart(2, "0")}-${employee.code}`,
    label: `Paie ${employee.firstName} ${employee.lastName} — ${month}/${year}`,
    lines, linkedDocType: "payslip", linkedDocId: payslip._id, createdBy: auth.userId,
  }], { session });
  payslip.accountingEntryId = entry._id;
  await payslip.save({ session });

  return { payslip, alerts: payroll.alerts };
}
