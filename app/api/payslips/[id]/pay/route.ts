import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { PayslipModel } from "@/models/Payslip";
import { accountBalance, recordMovement } from "@/lib/treasury";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { withTransaction } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const POST = withAuth("payslips", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const { treasuryAccountId } = body;

  const payslip = await PayslipModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .populate("employeeId", "firstName lastName code paymentTreasuryAccountId bankAccount");
  if (!payslip) return notFound("Bulletin introuvable");
  if (payslip.isPaid) return badRequest("Ce bulletin est déjà marqué comme payé");

  const accountId = treasuryAccountId || (payslip.employeeId as { paymentTreasuryAccountId?: string })?.paymentTreasuryAccountId;

  await withTransaction(async (session) => {
    payslip.isPaid = true;
    payslip.paidAt = new Date();
    await payslip.save({ session });

    if (accountId) {
      // Le solde est calculé, pas stocké : on le dérive des mouvements plutôt
      // que de lire un champ figé, et le versement s'inscrit comme mouvement.
      // `findById` seul lisait le compte d'un autre tenant sans le voir.
      const account = await accountBalance(auth.tenantId, String(accountId), session);
      if (!account) throw new Error("Compte de trésorerie introuvable");
      if (account.balance < payslip.netSalary) {
        throw new Error(`Solde insuffisant (${account.balance.toLocaleString("fr-FR")} XOF). Net à payer : ${payslip.netSalary.toLocaleString("fr-FR")} XOF`);
      }

      const empForLabel = payslip.employeeId as { firstName?: string; lastName?: string };
      await recordMovement({
        tenantId: auth.tenantId,
        accountId: String(accountId),
        date: new Date(),
        amount: -payslip.netSalary,
        label: `Salaire ${empForLabel.firstName ?? ""} ${empForLabel.lastName ?? ""} — ${payslip.month}/${payslip.year}`.trim(),
        source: "payroll",
        linkedDocType: "payslip",
        linkedDocId: payslip._id,
        createdBy: auth.userId,
      }, session);

      const emp = payslip.employeeId as { firstName?: string; lastName?: string; code?: string };
      await AccountingEntryModel.create([{
        tenantId: auth.tenantId, journalCode: "BQ",
        entryDate: new Date(),
        reference: `PAIE-${payslip.year}${String(payslip.month).padStart(2,"0")}-${emp.code || ""}`,
        label: `Virement salaire ${emp.firstName} ${emp.lastName} — ${payslip.month}/${payslip.year}`,
        lines: [
          { accountCode: "421000", accountLabel: "Rémunérations dues", debit: payslip.netSalary, credit: 0 },
          { accountCode: "521000", accountLabel: "Banque", debit: 0, credit: payslip.netSalary },
        ],
        linkedDocType: "payslip", linkedDocId: payslip._id, createdBy: auth.userId,
      }], { session });
    }
  });

  await logAudit(auth, "PAYMENT", "payslips", {
    resourceId: params.id,
    after: { isPaid: true, netSalary: payslip.netSalary },
  });

  return ok({ message: `Salaire de ${payslip.netSalary.toLocaleString("fr-FR")} XOF payé et déduit de la trésorerie`, payslip });
});
