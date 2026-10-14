import { NextRequest } from "next/server";
import { withAuth, ok, created, badRequest } from "@/lib/api-helpers";
import { withTransaction } from "@/lib/db";
import { TreasuryAccountModel } from "@/models/TreasuryAccount";
import { currentOpening, postOpeningBalances } from "@/lib/opening-balances";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

/** GET — reprise déjà passée (le cas échéant) et comptes de trésorerie à reprendre. */
export const GET = withAuth("accountingEntries", "read", async (_req: NextRequest, auth: TokenPayload) => {
  const [entry, accounts] = await Promise.all([
    currentOpening(auth.tenantId),
    TreasuryAccountModel.find({ tenantId: auth.tenantId, isActive: { $ne: false } }).select("label type ledgerCode openingBalance openingDate").lean(),
  ]);
  return ok({ entry, accounts });
});

/** POST { date, treasury: [{ accountId, amount }], lines: [{ accountCode, accountLabel, debit, credit, thirdPartyId? }] } */
export const POST = withAuth("accountingEntries", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json().catch(() => ({}));
  try {
    const r = await withTransaction(session => postOpeningBalances({ tenantId: auth.tenantId, userId: auth.userId }, body, session));
    await logAudit(auth, "CREATE", "accountingEntries", { resourceId: String(r.entryId), after: { opening: r.total, lines: r.lines } });
    return created(r);
  } catch (e) {
    if (e instanceof BusinessRuleError) return badRequest(e.message);
    throw e;
  }
});
