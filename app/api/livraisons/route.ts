import { Types } from "mongoose";
import { nextDocumentNumber } from "@/lib/numbering";
import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, created, badRequest, getPagination, paginatedResponse, tenantFilter, requireFields, sanitizeBody, notFound, conflict } from "@/lib/api-helpers";
import { DeliveryNoteModel } from "@/models/DeliveryNote";
import { InvoiceModel } from "@/models/Invoice";
import { ProductModel } from "@/models/Product";
import { applyMovement } from "@/lib/stock";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import { authCan } from "@/lib/role-resources";

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
      .populate("invoiceId", authCan(auth, "invoices", "read") ? "number totalTTC status" : "number status")
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
      warehouseId: body.warehouseId && Types.ObjectId.isValid(String(body.warehouseId)) ? body.warehouseId : undefined,
      status: "issued",
      createdBy: auth.userId,
    }], { session });

    // Déduction automatique du stock : chaque ligne rattachée à un produit
    // physique retire sa quantité du stock et laisse une trace de mouvement
    // liée au bon de livraison. Le tout dans la transaction : bon + stock
    // sont écrits ensemble, ou pas du tout.
    for (const line of (doc.lines || [])) {
      if (!line.productId || !(line.quantity > 0)) continue;
      const product = await ProductModel.findOne({ _id: line.productId, ...tenantFilter(auth) }).select("isService").session(session ?? null).lean<{ isService?: boolean } | null>();
      if (!product || product.isService) continue;
      // Sortie plafonnée au stock disponible (le bon reste émis) ; atomique.
      const raw = (Array.isArray(body.lines) ? body.lines : []).find((l: { productId?: unknown }) => String(l.productId) === String(line.productId)) as { lots?: [] } | undefined;
      await applyMovement({
        tenantId: auth.tenantId, userId: auth.userId, productId: line.productId, type: "exit",
        quantity: line.quantity, reason: `Bon de livraison ${number}`, allowPartial: true,
        // Entrepôt de départ (défaut : principal) ; lots précisés ou pris péremption la plus proche d'abord.
        warehouseId: body.warehouseId || undefined, lots: raw?.lots,
        linkedDocType: "delivery", linkedDocId: doc._id, linkedDocNumber: number,
      }, session);
    }
    return doc;
  });

  await logAudit(auth, "CREATE", "livraisons", {
    resourceId: delivery._id.toString(),
    after: { number: delivery.number, invoiceId: body.invoiceId },
  });

  return created(delivery);
});


