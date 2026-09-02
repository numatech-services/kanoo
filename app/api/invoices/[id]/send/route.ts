import { NextRequest } from "next/server";
import { withAuth, ok, notFound, badRequest, tenantFilter } from "@/lib/api-helpers";
import { InvoiceModel } from "@/models/Invoice";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
export const POST = withAuth("invoices", "update", async (_req: NextRequest, auth: TokenPayload, params) => {
  const invoice = await InvoiceModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!invoice) return notFound();
  if (invoice.status !== "draft") return badRequest("Seuls les brouillons peuvent être émis");
  invoice.status = "sent";
  await invoice.save();
  await logAudit(auth, "INVOICE_SENT", "invoices", { resourceId: params.id, after: { status: "sent", number: invoice.number } });
  return ok(invoice);
});
