import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, created, badRequest, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { hasFinanceAccess } from "@/lib/role-resources";
import { BankGuaranteeModel } from "@/models/BankGuarantee";
import { createGuarantee } from "@/lib/guarantees-server";
import { commitments, guaranteeAlert, guaranteeCost, nextCommission } from "@/lib/guarantees";
import { TreasuryAccountModel } from "@/models/TreasuryAccount";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** GET ?status=&appelId=&contractId= — cautions, engagements hors bilan en cours. */
export const GET = withAuth("appels", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  const status = url.searchParams.get("status");
  if (status && ["active", "released", "called", "cancelled"].includes(status)) filter.status = status;
  for (const f of ["appelId", "contractId"]) {
    const v = url.searchParams.get(f);
    if (v && Types.ObjectId.isValid(v)) filter[f] = v;
  }
  const items = await BankGuaranteeModel.find(filter).sort({ status: 1, expiryDate: 1, createdAt: -1 }).limit(500)
    .populate("appelId", "title reference").populate("contractId", "reference title").populate("treasuryAccountId", "label").populate("loanId", "label lender").lean<Array<Record<string, unknown> & { status: string; expiryDate?: Date }>>();
  const all = await BankGuaranteeModel.find({ ...tenantFilter(auth), status: "active" }).select("type amount status collateral direction treasuryAccountId").lean<Parameters<typeof commitments>[0]>();
  return ok({
    items: items.map(g => ({ ...g, alert: guaranteeAlert(g), cost: guaranteeCost(g as Parameters<typeof guaranteeCost>[0]), nextCommission: nextCommission(g as unknown as Parameters<typeof nextCommission>[0])[0] ?? null })),
    commitments: commitments(all),
    // Lignes de cautions : engagements en cours par banque, face au plafond accordé.
    banks: (await TreasuryAccountModel.find({ ...tenantFilter(auth), type: "bank" }).select("label guaranteeLimit").lean<Array<{ _id: unknown; label: string; guaranteeLimit?: number }>>())
      .map(b => ({ _id: String(b._id), label: b.label, limit: b.guaranteeLimit ?? null, used: (all as Array<{ amount: number; direction?: string; treasuryAccountId?: unknown }>).filter(g => g.direction !== "received" && String(g.treasuryAccountId ?? "") === String(b._id)).reduce((t, g) => t + g.amount, 0) }))
      .filter(b => b.limit !== null || b.used > 0),
  });
});

/** POST { type, beneficiary?, amount, issueDate, expiryDate?, treasuryAccountId?, bankName?, reference?, appelId?, contractId?, fee?, collateral?, notes? } */
export const POST = withAuth("appels", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  try {
    const g = await withTransaction(session => createGuarantee({ tenantId: auth.tenantId, userId: auth.userId }, body, { canPost: hasFinanceAccess(auth) }, session));
    await logAudit(auth, "CREATE", "appels", { resourceId: String(g._id), metadata: { guarantee: g.type, amount: g.amount } });
    // Ligne de cautions de la banque : dépassement signalé (la banque peut refuser).
    let warning: string | undefined;
    if (g.direction !== "received" && g.treasuryAccountId) {
      const bank = await TreasuryAccountModel.findOne({ _id: g.treasuryAccountId, ...tenantFilter(auth) }).select("label guaranteeLimit").lean<{ label: string; guaranteeLimit?: number } | null>();
      if (bank?.guaranteeLimit !== undefined && bank.guaranteeLimit !== null) {
        const [u] = await BankGuaranteeModel.aggregate<{ t: number }>([{ $match: { tenantId: g.tenantId, treasuryAccountId: g.treasuryAccountId, status: "active", direction: { $ne: "received" } } }, { $group: { _id: null, t: { $sum: "$amount" } } }]);
        if ((u?.t ?? 0) > bank.guaranteeLimit) warning = `Ligne de cautions de ${bank.label} dépassée : ${(u?.t ?? 0).toLocaleString("fr-FR")} FCFA engagés pour un plafond de ${bank.guaranteeLimit.toLocaleString("fr-FR")}.`;
      }
    }
    return created({ ...(g.toObject ? g.toObject() : g), warning });
  } catch (e) {
    if (e instanceof BusinessRuleError) return badRequest(e.message);
    throw e;
  }
});
