import { nextDocumentNumber } from "@/lib/numbering";
import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
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

  const count = await DeliveryNoteModel.countDocuments({ tenantId: auth.tenantId });
  const year = new Date().getFullYear();
  const number = await nextDocumentNumber(auth.tenantId, "delivery");

  const delivery = await DeliveryNoteModel.create({
    ...body,
    tenantId: auth.tenantId,
    number,
    clientId: body.clientId || invoice.clientId,
    status: "issued",
    createdBy: auth.userId,
  });

  await logAudit(auth, "CREATE", "livraisons", {
    resourceId: delivery._id.toString(),
    after: { number, invoiceId: body.invoiceId },
  });

  return created(delivery);
});

function notFound(msg?: string) {
  const { NextResponse } = require("next/server");
  return NextResponse.json({ success: false, error: msg || "Introuvable" }, { status: 404 });
}
