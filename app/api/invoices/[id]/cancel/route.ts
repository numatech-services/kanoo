import { NextRequest } from "next/server";
import { withAuth, ok, notFound, badRequest, tenantFilter } from "@/lib/api-helpers";
import { InvoiceModel } from "@/models/Invoice";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
export const POST = withAuth("invoices", "update", async (_req: NextRequest, auth: TokenPayload, params) => {
  const invoice = await InvoiceModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!invoice) return notFound();
  if (invoice.status === "paid") return badRequest("Impossible d'annuler une facture soldée");
  if (invoice.paidAmount > 0) return badRequest("Impossible d'annuler une facture partiellement payée");
  invoice.status = "cancelled";
  await invoice.save();
  await logAudit(auth, "UPDATE", "invoices", { resourceId: params.id, after: { status: "cancelled" } });
  return ok(invoice);
});
