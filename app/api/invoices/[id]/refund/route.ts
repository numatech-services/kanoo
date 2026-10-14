import { NextRequest } from "next/server";
import { withAuth, ok, notFound, badRequest, tenantFilter } from "@/lib/api-helpers";
import { InvoiceModel } from "@/models/Invoice";
import { withTransaction } from "@/lib/db";
import { refundableFor, refundCreditNote } from "@/lib/refunds";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

/** GET — montant remboursable au client sur cet avoir. */
export const GET = withAuth("payments", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const cn = await InvoiceModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .select("number documentType status clientId totalTTC originalInvoiceId refundedAmount refunds").lean();
  if (!cn) return notFound();
  const doc = cn as unknown as Parameters<typeof refundableFor>[1] & { refunds?: unknown[] };
  return ok({ refundable: await refundableFor(auth.tenantId, doc), refunded: doc.refundedAmount ?? 0, refunds: doc.refunds ?? [] });
});

/** POST — rembourse le client : { treasuryAccountId, amount?, date?, reference? }. */
export const POST = withAuth("payments", "create", async (req: NextRequest, auth: TokenPayload, params) => {
  const body = await req.json().catch(() => ({}));
  try {
    const r = await withTransaction(session => refundCreditNote({ tenantId: auth.tenantId, userId: auth.userId }, params.id, body, session));
    await logAudit(auth, "PAYMENT", "invoices", { resourceId: params.id, after: { refund: r.amount } });
    return ok(r);
  } catch (e) {
    if (e instanceof BusinessRuleError) return badRequest(e.message);
    throw e;
  }
});
