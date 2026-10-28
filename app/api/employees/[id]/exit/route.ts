import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, tenantFilter, forbidden } from "@/lib/api-helpers";
import { EmployeeModel } from "@/models/Employee";
import { PayslipModel } from "@/models/Payslip";
import { leaveBalance, hrPolicy } from "@/lib/leaves";
import { finalSettlement } from "@/lib/final-settlement";
import { generatePayslip, type PayrollEmployee } from "@/lib/payroll-run";
import { authCan } from "@/lib/role-resources";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Row = PayrollEmployee & { isActive: boolean; leaveOpeningBalance?: number };

async function compute(auth: TokenPayload, id: string, dateRaw: string | null) {
  const exitDate = dateRaw ? new Date(dateRaw) : new Date();
  if (isNaN(exitDate.getTime())) return { error: "Date de sortie invalide." } as const;
  const e = await EmployeeModel.findOne({ _id: id, ...tenantFilter(auth) }).lean<Row | null>();
  if (!e) return { error: "Collaborateur introuvable", missing: true } as const;
  if (exitDate < new Date(e.startDate)) return { error: "La sortie précède l'entrée." } as const;
  const bal = await leaveBalance(auth.tenantId, e, { at: exitDate, maxBalanceDays: (await hrPolicy(auth.tenantId)).maxBalanceDays });
  const type = e.employeeType ?? "employee";
  const s = finalSettlement({ exitDate, startDate: e.startDate, monthlyBase: type === "employee" ? e.grossSalary ?? 0 : e.indemnity ?? 0, employeeType: type, leaveAvailable: bal.available });
  const existing = await PayslipModel.findOne({ tenantId: auth.tenantId, employeeId: e._id, month: s.month, year: s.year }).select("_id").lean<{ _id: unknown } | null>();
  return { e, exitDate, settlement: s, leave: bal, existingPayslipId: existing?._id ?? null };
}

/** GET ?date= — solde de tout compte prévisionnel à la date de sortie. */
export const GET = withAuth("employees", "read", async (req: NextRequest, auth: TokenPayload, params) => {
  if (!authCan(auth, "payslips", "read")) return forbidden("Réservé à la paie.");
  await connectDB();
  const r = await compute(auth, params.id, new URL(req.url).searchParams.get("date"));
  if ("error" in r) return "missing" in r ? notFound(r.error) : badRequest(r.error ?? "Requête invalide");
  return ok({ settlement: r.settlement, leave: r.leave, existingPayslipId: r.existingPayslipId });
});

/**
 * POST { date, reason, payslip?: boolean } — enregistre la sortie et, sur
 * demande, le bulletin du mois de sortie : salaire au prorata et indemnité
 * compensatrice de congés (prime soumise). Tout ou rien.
 */
export const POST = withAuth("employees", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const r = await compute(auth, params.id, body.date ? String(body.date) : null);
  if ("error" in r) return "missing" in r ? notFound(r.error) : badRequest(r.error ?? "Requête invalide");
  if (!r.e.isActive) return badRequest("Ce collaborateur est déjà sorti.");
  const wantSlip = body.payslip === true;
  if (wantSlip && !authCan(auth, "payslips", "create")) return forbidden("Bulletin de sortie réservé à la paie.");
  if (wantSlip && r.existingPayslipId) return badRequest("Le bulletin de ce mois existe déjà : ajoutez l'indemnité de congés sur un bulletin rectificatif, ou enregistrez la sortie seule.");
  const s = r.settlement;
  const reason = String(body.reason ?? "").slice(0, 200) || undefined;
  const slip = await withTransaction(async session => {
    let made = null;
    if (wantSlip) {
      made = await generatePayslip(auth, r.e, {
        month: s.month, year: s.year, grossSalary: s.proratedBase || undefined,
        items: s.leaveIndemnity > 0 ? [{ label: `Indemnité compensatrice de congés payés (${s.leaveDays} j)`, amount: s.leaveIndemnity, type: "addition" }] : [],
      }, session);
    }
    await EmployeeModel.updateOne({ _id: r.e._id }, { $set: { isActive: false, endDate: r.exitDate, ...(reason ? { exitReason: reason } : {}) } }, { session });
    return made;
  });
  await logAudit(auth, "UPDATE", "employees", { resourceId: params.id, metadata: { exit: r.exitDate, reason, settlement: s, payslip: !!slip } });
  return ok({ settlement: s, payslip: slip });
});
