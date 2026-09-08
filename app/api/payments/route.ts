import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, created, badRequest, notFound, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { PaymentModel } from "@/models/Payment";
import { InvoiceModel } from "@/models/Invoice";
import { withTransaction } from "@/lib/db";
import { applyPaymentEffects } from "@/lib/payments";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("payments", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const invoiceId = url.searchParams.get("invoiceId");

  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  if (invoiceId) filter.invoiceId = invoiceId;

  const [items, total] = await Promise.all([
    PaymentModel.find(filter)
      // On peuple la facture, ET à l'intérieur de la facture, on peuple le client
      .populate({
        path: "invoiceId",
        select: "number totalTTC clientId",
        populate: {
          path: "clientId",
          select: "name"
        }
      })
      .populate("treasuryAccountId", "name")
      .sort({ date: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    PaymentModel.countDocuments(filter),
  ]);

  return paginatedResponse(items, total, pagination);
});
export const POST = withAuth("payments", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json();
  const missing = requireFields(body, ["invoiceId", "amount", "method", "date"]);
  if (missing) return badRequest(missing);

  await connectDB();

  const invoice = await InvoiceModel.findOne({ _id: body.invoiceId, tenantId: auth.tenantId });
  if (!invoice) return notFound("Facture introuvable");
  if (invoice.status === "paid" || invoice.status === "cancelled") {
    return badRequest(`Cette facture est déjà ${invoice.status === "paid" ? "soldée" : "annulée"}`);
  }

  const amount = Number(body.amount);
  const remaining = invoice.totalTTC - invoice.paidAmount;
  if (amount > remaining + 1) {
    return badRequest(`Montant maximum payable : ${remaining} XOF (reste à payer)`);
  }

  // « pending » = promesse enregistrée, sans effet comptable ; « effective » =
  // encaissé, on solde la facture et on écrit compta + trésorerie.
  const status = body.status === "pending" ? "pending" : "effective";

  const result = await withTransaction(async (session) => {
    const [payment] = await PaymentModel.create(
      [{ ...body, status, tenantId: auth.tenantId, createdBy: auth.userId }],
      { session }
    );
    if (status === "effective") await applyPaymentEffects(payment, invoice, auth, session);
    return payment;
  });

  await logAudit(auth, "PAYMENT", "payments", {
    resourceId: result._id.toString(),
    after: { invoiceId: body.invoiceId, amount, method: body.method, status },
  });

  return created(result);
});
