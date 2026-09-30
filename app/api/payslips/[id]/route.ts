import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, notFound, noContent, badRequest, tenantFilter } from "@/lib/api-helpers";
import { PayslipModel } from "@/models/Payslip";
import { TenantModel } from "@/models/Tenant";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { reverseEntry } from "@/lib/accounting-reversal";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("payslips", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const [p, tenant] = await Promise.all([
    PayslipModel.findOne({ _id: params.id, ...tenantFilter(auth) })
      .populate("employeeId", "firstName lastName code position department employeeType cnssNumber nif bankAccount bankName startDate contractNature")
      .lean(),
    // Identité de l'employeur imprimée sur le bulletin (elle était codée en dur).
    TenantModel.findById(auth.tenantId).select("name nif rccm address phone email logo").lean(),
  ]);
  if (!p) return notFound();
  return ok({ ...p, employer: tenant });
});

// Le statut « payé » ne se modifie plus à la main : il passe par /pay, qui
// enregistre le décaissement et l'écriture. L'ancien PATCH isPaid les contournait.

/**
 * DELETE — supprime un bulletin NON payé (erreur de saisie, régénération) :
 * son écriture de paie est extournée dans la même transaction.
 */
export const DELETE = withAuth("payslips", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const p = await PayslipModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!p) return notFound();
  if (p.isPaid) return badRequest("Bulletin déjà payé : il ne peut plus être supprimé.");
  await withTransaction(async session => {
    // Bulletins antérieurs au lien direct : l'écriture se retrouve par le document lié.
    const entryId = p.accountingEntryId ?? (await AccountingEntryModel.findOne({
      tenantId: auth.tenantId, linkedDocType: "payslip", linkedDocId: p._id, journalCode: "OD", reversedBy: { $exists: false },
    }).select("_id").session(session ?? null).lean<{ _id: unknown } | null>())?._id;
    if (entryId) {
      await reverseEntry({ tenantId: auth.tenantId, userId: auth.userId, entryId, reason: "bulletin supprimé" }, session);
    }
    await PayslipModel.deleteOne({ _id: p._id }, { session });
  });
  await logAudit(auth, "DELETE", "payslips", { resourceId: params.id, before: { month: p.month, year: p.year, netSalary: p.netSalary } });
  return noContent();
});
