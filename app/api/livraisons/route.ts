import { nextDocumentNumber } from "@/lib/numbering";
import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, created, badRequest, getPagination, paginatedResponse, tenantFilter, requireFields, sanitizeBody, notFound } from "@/lib/api-helpers";
import { DeliveryNoteModel } from "@/models/DeliveryNote";
import { InvoiceModel } from "@/models/Invoice";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("livraisons", "read", async (req: NextRequest, auth: TokenPayload) => {
    await connectDB();
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const invoiceId = url.searchParams.get("invoiceId");
  const status = url.searchParams.get("status");

  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  if (invoiceId) filter.invoiceId = invoiceId;
  if (status) filter.status = status;

  const [items, total] = await Promise.all([
    DeliveryNoteModel.find(filter)
      .populate("invoiceId", "number totalTTC status")
      .populate("clientId", "name code address")
      .sort({ createdAt: -1 })
      .skip(pagination.skip).limit(pagination.limit).lean(),
    DeliveryNoteModel.countDocuments(filter),
  ]);
  return paginatedResponse(items, total, pagination);
});

export const POST = withAuth("livraisons", "create", async (req: NextRequest, auth: TokenPayload) => {
    await connectDB();
  const body = await req.json();
  const err = requireFields(body, ["invoiceId", "deliveryDate", "lines"]);
  if (err) return badRequest(err);

  const invoice = await InvoiceModel.findOne({ _id: body.invoiceId, ...tenantFilter(auth) });
  if (!invoice) return notFound("Facture introuvable");
  if (!["sent", "partial", "paid"].includes(invoice.status)) {
    return badRequest("Un bon de livraison ne peut être créé que pour une facture émise, partiellement payée ou soldée");
  }

  const delivery = await withTransaction(async (session) => {
    const number = await nextDocumentNumber(auth.tenantId, "delivery", {
      issueDate: body.deliveryDate, session,
    });
    const [doc] = await DeliveryNoteModel.create([{
      ...sanitizeBody(body, ["number", "status"]),
      tenantId: auth.tenantId,
      number,
      clientId: body.clientId || invoice.clientId,
      status: "issued",
      createdBy: auth.userId,
    }], { session });
    return doc;
  });

  await logAudit(auth, "CREATE", "livraisons", {
    resourceId: delivery._id.toString(),
    after: { number: delivery.number, invoiceId: body.invoiceId },
  });

  return created(delivery);
});


