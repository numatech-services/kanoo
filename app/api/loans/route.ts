import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { LoanModel } from "@/models/Loan";
import { createLoan, loanState, openingCheck } from "@/lib/loans-server";

export const dynamic = "force-dynamic";

/** GET — emprunts, avec capital restant dû, prochaine échéance et retards. */
export const GET = withAuth("accountingEntries", "read", async (_req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const loans = await LoanModel.find(tenantFilter(auth)).sort({ status: 1, startDate: -1 }).populate("treasuryAccountId", "label").lean<Array<Record<string, unknown> & { principal: number; status: string; installments: never[] }>>();
  const items = loans.map(l => ({ ...l, installments: undefined, state: loanState(l) }));
  const live = items.filter(l => l.status !== "closed");
  return ok({ items, openingCheck: await openingCheck(auth.tenantId), totals: { remaining: live.reduce((t, l) => t + l.state.remaining, 0), overdue: live.reduce((t, l) => t + l.state.overdue.amount, 0), interestLeft: live.reduce((t, l) => t + l.state.interestLeft, 0) } });
});

/** POST — nouvel emprunt (tableau calculé, rien de comptabilisé avant le déblocage). */
export const POST = withAuth("accountingEntries", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  try {
    const loan = await createLoan({ tenantId: auth.tenantId, userId: auth.userId }, body);
    await logAudit(auth, "CREATE", "accountingEntries", { resourceId: String(loan._id), metadata: { loan: loan.label, principal: loan.principal, lender: loan.lender } });
    return created(loan);
  } catch (e) { if (e instanceof BusinessRuleError) return badRequest(e.message); throw e; }
});
