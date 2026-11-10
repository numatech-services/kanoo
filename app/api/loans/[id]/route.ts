import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, noContent, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { LoanModel } from "@/models/Loan";
import { adjustInstallment, cancelInstallment, deleteLoan, disburseLoan, loanState, payInstallment } from "@/lib/loans-server";
import { scheduleTotals } from "@/lib/loan-schedule";

export const dynamic = "force-dynamic";

export const GET = withAuth("accountingEntries", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!Types.ObjectId.isValid(params.id)) return notFound();
  const loan = await LoanModel.findOne({ _id: params.id, ...tenantFilter(auth) }).populate("treasuryAccountId", "label").populate("projectId", "code name")
    .lean<Record<string, unknown> & { principal: number; status: string; installments: Array<{ n: number; dueDate: Date; principal: number; interest: number; insurance: number; status: string }> }>();
  if (!loan) return notFound("Emprunt introuvable");
  return ok({ ...loan, state: loanState(loan), totals: scheduleTotals(loan.installments) });
});

/** POST { action: disburse | pay | cancel | adjust, … } */
export const POST = withAuth("accountingEntries", "create", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!Types.ObjectId.isValid(params.id)) return notFound();
  const body = await req.json().catch(() => ({}));
  const actor = { tenantId: auth.tenantId, userId: auth.userId };
  try {
    let loan;
    if (body.action === "disburse") loan = await withTransaction(s => disburseLoan(actor, params.id, body, s));
    else if (body.action === "pay") loan = await withTransaction(s => payInstallment(actor, params.id, body, s));
    else if (body.action === "cancel") loan = await withTransaction(s => cancelInstallment(actor, params.id, body, s));
    else if (body.action === "adjust") loan = await adjustInstallment(actor, params.id, body);
    else return badRequest("Action inconnue (disburse, pay, cancel, adjust).");
    await logAudit(auth, "UPDATE", "accountingEntries", { resourceId: params.id, metadata: { loan: body.action, installmentId: body.installmentId } });
    return ok(loan);
  } catch (e) { if (e instanceof BusinessRuleError) return badRequest(e.message); throw e; }
});

export const DELETE = withAuth("accountingEntries", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  try {
    await deleteLoan({ tenantId: auth.tenantId, userId: auth.userId }, params.id);
    await logAudit(auth, "DELETE", "accountingEntries", { resourceId: params.id, metadata: { loanDeleted: true } });
    return noContent();
  } catch (e) { if (e instanceof BusinessRuleError) return badRequest(e.message); throw e; }
});
