import { NextRequest } from "next/server";
import { withAuth, ok, notFound, badRequest, tenantFilter } from "@/lib/api-helpers";
import { InvoiceModel } from "@/models/Invoice";
import { withTransaction } from "@/lib/db";
import { issueInvoice } from "@/lib/invoice-posting";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

/** POST — émet un brouillon : il devient opposable et entre en comptabilité. */
export const POST = withAuth("invoices", "update", async (_req: NextRequest, auth: TokenPayload, params) => {
  const found = await InvoiceModel.exists({ _id: params.id, ...tenantFilter(auth) });
  if (!found) return notFound();
  const invoice = await withTransaction(async session => {
    const inv = await InvoiceModel.findOne({ _id: params.id, ...tenantFilter(auth) }).session(session ?? null);
    if (!inv || inv.status !== "draft") return null;
    return issueInvoice({ tenantId: auth.tenantId, userId: auth.userId }, inv, session);
  });
  if (!invoice) return badRequest("Seuls les brouillons peuvent être émis");
  await logAudit(auth, "INVOICE_SENT", "invoices", { resourceId: params.id, after: { status: "sent", number: invoice.number } });
  return ok(invoice);
});
