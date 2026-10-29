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
import { searchCondition, withSearch } from "@/lib/list-search";
import { authCan } from "@/lib/role-resources";

import { allocateDelivery, deliveredByLine } from "@/lib/deliveries";
import { BusinessRuleError } from "@/lib/errors";
export const GET = withAuth("livraisons", "read", async (req: NextRequest, auth: TokenPayload) => {
    await connectDB();
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const invoiceId = url.searchParams.get("invoiceId");
  const status = url.searchParams.get("status");

  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  // Raccourci « Voir les … » de la fiche client.
  const clientId = url.searchParams.get("clientId");
  if (clientId && Types.ObjectId.isValid(clientId)) filter.clientId = new Types.ObjectId(clientId);
  if (invoiceId) filter.invoiceId = invoiceId;
  if (status) filter.status = status;
  withSearch(filter, await searchCondition(auth.tenantId, url.searchParams.get("search"), { fields: ["number", "lines.description"], client: "clientId", invoice: "invoiceId" }));

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

  const requested = Array.isArray(body.lines) ? body.lines as Array<Record<string, unknown>> : [];
  let delivery;
  try {
  delivery = await withTransaction(async (session) => {
    // Reste à livrer, lu dans la transaction : deux bons simultanés ne peuvent
    // pas livrer deux fois la même quantité.
    const alloc = allocateDelivery(invoice.lines, await deliveredByLine(auth.tenantId, invoice._id, session), requested);
    if (!alloc.ok) throw new BusinessRuleError(alloc.error);
    const lines = alloc.lines.map((l, k) => {
      const raw = requested.find(r => Number(r.invoiceLineIndex) === l.invoiceLineIndex) ?? requested[k] ?? {};
      const src = invoice.lines[l.invoiceLineIndex] as { unit?: string; details?: string; section?: string };
      return { ...l, unit: src.unit || String(raw.unit || "unité"), ...(src.details ? { details: src.details } : {}), ...(src.section ? { section: src.section } : {}),
        ...(raw.serialNumber ? { serialNumber: String(raw.serialNumber).slice(0, 80) } : {}), ...(raw.notes ? { notes: String(raw.notes).slice(0, 300) } : {}) };
    });
    // Numéro attribué automatiquement, mais une référence saisie à la main est
    // respectée (l'utilisateur peut la changer).
    const number = customNumber
      ? customNumber
      : await nextDocumentNumber(auth.tenantId, "delivery", { issueDate: body.deliveryDate, session });
    const [doc] = await DeliveryNoteModel.create([{
      ...sanitizeBody(body, ["number", "status", "lines"]),
      lines,
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
  } catch (e) {
    if (e instanceof BusinessRuleError) return badRequest(e.message);
    throw e;
  }

  await logAudit(auth, "CREATE", "livraisons", {
    resourceId: delivery._id.toString(),
    after: { number: delivery.number, invoiceId: body.invoiceId },
  });

  return created(delivery);
});


