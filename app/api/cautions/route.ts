import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, created, badRequest, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { hasFinanceAccess } from "@/lib/role-resources";
import { BankGuaranteeModel } from "@/models/BankGuarantee";
import { createGuarantee } from "@/lib/guarantees-server";
import { commitments, guaranteeAlert } from "@/lib/guarantees";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** GET ?status=&appelId=&contractId= — cautions, engagements hors bilan en cours. */
export const GET = withAuth("appels", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  const status = url.searchParams.get("status");
  if (status && ["active", "released", "called"].includes(status)) filter.status = status;
  for (const f of ["appelId", "contractId"]) {
    const v = url.searchParams.get(f);
    if (v && Types.ObjectId.isValid(v)) filter[f] = v;
  }
  const items = await BankGuaranteeModel.find(filter).sort({ status: 1, expiryDate: 1, createdAt: -1 }).limit(500)
    .populate("appelId", "title reference").populate("contractId", "reference title").populate("treasuryAccountId", "label").lean<Array<Record<string, unknown> & { status: string; expiryDate?: Date }>>();
  const all = await BankGuaranteeModel.find({ ...tenantFilter(auth), status: "active" }).select("type amount status collateral").lean<Parameters<typeof commitments>[0]>();
  return ok({
    items: items.map(g => ({ ...g, alert: guaranteeAlert(g) })),
    commitments: commitments(all),
  });
});

/** POST { type, beneficiary?, amount, issueDate, expiryDate?, treasuryAccountId?, bankName?, reference?, appelId?, contractId?, fee?, collateral?, notes? } */
export const POST = withAuth("appels", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  try {
    const g = await withTransaction(session => createGuarantee({ tenantId: auth.tenantId, userId: auth.userId }, body, { canPost: hasFinanceAccess(auth) }, session));
    await logAudit(auth, "CREATE", "appels", { resourceId: String(g._id), metadata: { guarantee: g.type, amount: g.amount } });
    return created(g);
  } catch (e) {
    if (e instanceof BusinessRuleError) return badRequest(e.message);
    throw e;
  }
});
