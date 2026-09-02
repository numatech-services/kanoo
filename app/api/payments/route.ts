import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, notFound, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { PaymentModel } from "@/models/Payment";
import { InvoiceModel } from "@/models/Invoice";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { withTransaction } from "@/lib/db";
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

  const result = await withTransaction(async (session) => {
    // 1. Créer le paiement
    const [payment] = await PaymentModel.create(
      [{ ...body, tenantId: auth.tenantId, createdBy: auth.userId }],
      { session }
    );

    // 2. Mettre à jour la facture
    invoice.paidAmount += amount;
    if (invoice.paidAmount >= invoice.totalTTC - 1) {
      invoice.status = "paid";
    } else {
      invoice.status = "partial";
    }
    await invoice.save({ session });

    // 3. Écriture comptable automatique (BQ — Banque ou CA — Caisse)
    const journalCode = body.method === "cash" ? "CA" : "BQ";
    const bankAccount = body.method === "cash" ? "571000" : "521000";
    await AccountingEntryModel.create(
      [{
        tenantId: auth.tenantId,
        journalCode,
        entryDate: new Date(body.date),
        reference: `PMNT-${payment._id.toString().slice(-6).toUpperCase()}`,
        label: `Règlement facture ${invoice.number}`,
        lines: [
          { accountCode: bankAccount, accountLabel: body.method === "cash" ? "Caisse" : "Banque", debit: amount, credit: 0 },
          { accountCode: "411000", accountLabel: "Clients", debit: 0, credit: amount, thirdPartyId: invoice.clientId },
        ],
        linkedDocType: "payment",
        linkedDocId: payment._id,
        createdBy: auth.userId,
      }],
      { session }
    );

    return payment;
  });

  await logAudit(auth, "PAYMENT", "payments", {
    resourceId: result._id.toString(),
    after: { invoiceId: body.invoiceId, amount, method: body.method },
  });

  return created(result);
});
