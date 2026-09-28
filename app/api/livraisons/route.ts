import { nextDocumentNumber } from "@/lib/numbering";
import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, created, badRequest, getPagination, paginatedResponse, tenantFilter, requireFields, sanitizeBody, notFound, conflict } from "@/lib/api-helpers";
import { DeliveryNoteModel } from "@/models/DeliveryNote";
import { InvoiceModel } from "@/models/Invoice";
import { ProductModel } from "@/models/Product";
import { StockMovementModel } from "@/models/StockMovement";
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

  // Référence saisie à la main : elle doit rester unique (index {tenantId, number}).
  const customNumber = typeof body.number === "string" ? body.number.trim().slice(0, 40) : "";
  if (customNumber && await DeliveryNoteModel.exists({ ...tenantFilter(auth), number: customNumber })) {
    return conflict(`La référence ${customNumber} est déjà utilisée par un autre bon de livraison.`);
  }

  const delivery = await withTransaction(async (session) => {
    // Numéro attribué automatiquement, mais une référence saisie à la main est
    // respectée (l'utilisateur peut la changer).
    const number = customNumber
      ? customNumber
      : await nextDocumentNumber(auth.tenantId, "delivery", { issueDate: body.deliveryDate, session });
    const [doc] = await DeliveryNoteModel.create([{
      ...sanitizeBody(body, ["number", "status"]),
      tenantId: auth.tenantId,
      number,
      clientId: body.clientId || invoice.clientId,
      status: "issued",
      createdBy: auth.userId,
    }], { session });

    // Déduction automatique du stock : chaque ligne rattachée à un produit
    // physique retire sa quantité du stock et laisse une trace de mouvement
    // liée au bon de livraison. Le tout dans la transaction : bon + stock
    // sont écrits ensemble, ou pas du tout.
    for (const line of (doc.lines || [])) {
      if (!line.productId || !(line.quantity > 0)) continue;
      const product = await ProductModel.findOne({ _id: line.productId, ...tenantFilter(auth) }).session(session ?? null);
      if (!product || product.isService) continue;
      const before = product.stockQty || 0;
      const after = Math.max(0, before - line.quantity);
      await StockMovementModel.create([{
        productId: product._id, tenantId: auth.tenantId, type: "exit",
        quantity: -(before - after), quantityBefore: before, quantityAfter: after,
        reason: `Bon de livraison ${number}`, linkedDocNumber: number, createdBy: auth.userId,
      }], { session });
      product.stockQty = after;
      await product.save({ session });
    }
    return doc;
  });

  await logAudit(auth, "CREATE", "livraisons", {
    resourceId: delivery._id.toString(),
    after: { number: delivery.number, invoiceId: body.invoiceId },
  });

  return created(delivery);
});


