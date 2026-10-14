import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, created, badRequest, notFound, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { PaymentModel } from "@/models/Payment";
import { InvoiceModel } from "@/models/Invoice";
import { withTransaction } from "@/lib/db";
import { applyPaymentEffects, invoiceDue, MAX_EXCHANGE_RATE } from "@/lib/payments";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import { paymentDate } from "@/lib/payment-date";
import { treasuryKind } from "@/lib/treasury";

const METHODS = ["cash", "bank_transfer", "cheque", "mobile_money", "other"];

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
      .populate("treasuryAccountId", "label type")
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
  if (["paid", "cancelled", "written_off"].includes(invoice.status)) {
    return badRequest(`Cette facture est déjà ${invoice.status === "paid" ? "soldée" : invoice.status === "cancelled" ? "annulée" : "passée en perte"}`);
  }

  const amount = Number(body.amount);
  if (!(amount > 0)) return badRequest("Montant invalide.");
  if (!METHODS.includes(body.method)) return badRequest("Mode de paiement invalide.");
  // Retenue à la source subie (marchés publics…) : le client a versé le net.
  const withholdingAmount = Math.round(Number(body.withholdingAmount) || 0);
  if (withholdingAmount < 0) return badRequest("Retenue invalide.");
  const remaining = invoiceDue(invoice);
  // Écart de change (règlement en devise) : > 0 perte, < 0 gain ; la facture est soldée de amount + retenue + écart.
  const exchangeDifference = Math.round(Number(body.exchangeDifference) || 0);
  if (Math.abs(exchangeDifference) > Math.round(remaining * MAX_EXCHANGE_RATE)) {
    return badRequest(`Écart de change trop élevé (au plus ${Math.round(MAX_EXCHANGE_RATE * 100)} % du reste à payer).`);
  }
  if (amount + withholdingAmount + exchangeDifference > remaining + 1) {
    return badRequest(`Encaissement${withholdingAmount ? ", retenue" : ""}${exchangeDifference ? " et écart de change" : " et retenue"} dépassent le reste à payer (${remaining} FCFA).`);
  }
  if (amount + withholdingAmount + exchangeDifference <= 0) return badRequest("Montant soldé invalide.");

  // « pending » = promesse enregistrée, sans effet comptable ; « effective » =
  // encaissé, on solde la facture et on écrit compta + trésorerie.
  const status = body.status === "pending" ? "pending" : "effective";
  // Date réelle de l'encaissement (passée ou du jour) ; un paiement en attente
  // peut porter la date promise.
  const date = status === "effective" ? paymentDate(body.date) : new Date(String(body.date));
  if (isNaN(date.getTime())) return badRequest("Date invalide.");
  // Compte encaisseur : un compte de l'organisation, jamais un identifiant quelconque.
  const treasuryAccountId = body.treasuryAccountId ? String(body.treasuryAccountId) : undefined;
  // Un encaissement effectif crédite un compte réel : sans lui, l'écriture partait
  // en banque mais le solde de trésorerie ne bougeait pas (grand livre ≠ trésorerie).
  if (status === "effective" && !treasuryAccountId) return badRequest("Choisissez le compte (banque, caisse, mobile money) qui a reçu l'argent.");
  if (treasuryAccountId && !(await treasuryKind(auth.tenantId, treasuryAccountId))) return badRequest("Compte de trésorerie introuvable.");

  const result = await withTransaction(async (session) => {
    const [payment] = await PaymentModel.create(
      [{
        invoiceId: invoice._id, amount, method: body.method, date, status, withholdingAmount, exchangeDifference,
        reference: body.reference ? String(body.reference).slice(0, 120) : undefined,
        notes: body.notes ? String(body.notes).slice(0, 1000) : undefined,
        ...(treasuryAccountId ? { treasuryAccountId } : {}),
        tenantId: auth.tenantId, createdBy: auth.userId,
      }],
      { session }
    );
    if (status === "effective") await applyPaymentEffects(payment, invoice, auth, session);
    return payment;
  });

  await logAudit(auth, "PAYMENT", "payments", {
    resourceId: result._id.toString(),
    after: { invoiceId: body.invoiceId, amount, withholdingAmount, exchangeDifference, method: body.method, status },
  });

  return created(result);
});
