import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import {
  withAuth, ok, created, badRequest, notFound, paginatedResponse,
  getPagination, tenantFilter, requireFields
} from "@/lib/api-helpers";
import { InvoiceModel } from "@/models/Invoice";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { ClientModel } from "@/models/Client";
import { logAudit } from "@/lib/audit";
import { calculerTVA, calculerDTS } from "@/lib/niger-fiscal";
import { nextDocumentNumber } from "@/lib/numbering";
import { withTransaction } from "@/lib/db";
import { TokenPayload } from "@/lib/auth";

// GET /api/invoices
export const GET = withAuth("invoices", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const clientId = url.searchParams.get("clientId");
  const search = url.searchParams.get("search") || "";
  const overdue = url.searchParams.get("overdue");

  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  if (status) filter.status = status;
  if (clientId) filter.clientId = clientId;
  if (overdue === "true") {
    filter.status = { $in: ["sent", "partial"] };
    filter.dueDate = { $lt: new Date() };
  }
  if (search) {
    filter.$or = [
      { number: { $regex: search, $options: "i" } },
    ];
  }

  const [items, total] = await Promise.all([
    InvoiceModel.find(filter)
      .populate("clientId", "name code nif")
      .sort({ issueDate: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    InvoiceModel.countDocuments(filter),
  ]);

  return paginatedResponse(items, total, pagination);
});

// POST /api/invoices — Créer + écritures comptables automatiques
export const POST = withAuth("invoices", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json();
  const missing = requireFields(body, ["clientId", "lines", "issueDate", "dueDate"]);
  if (missing) return badRequest(missing);

  await connectDB();

  const client = await ClientModel.findOne({ _id: body.clientId, tenantId: auth.tenantId });
  if (!client) return notFound("Client introuvable");

  // Calcul des totaux ligne par ligne
  let totalHT = 0;
  let totalTVA = 0;
  const lines = body.lines.map((line: {
    description: string;
    quantity: number;
    unitPrice: number;
    tvaRate?: number;
    discount?: number;
    productId?: string;
  }) => {
    const ht = line.quantity * line.unitPrice * (1 - (line.discount || 0) / 100);
    const tva = calculerTVA(ht, line.tvaRate ?? 0.19);
    totalHT += ht;
    totalTVA += tva;
    return { ...line, totalHT: Math.round(ht), totalTVA: Math.round(tva), totalTTC: Math.round(ht + tva) };
  });

  const totalDTS = calculerDTS(totalHT + totalTVA);
  const totalTTC = Math.round(totalHT + totalTVA + totalDTS);

  // Numérotation séquentielle
  const number = await nextDocumentNumber(auth.tenantId, "invoice");

  const result = await withTransaction(async (session) => {
    // 1. Créer la facture
    const [invoice] = await InvoiceModel.create(
      [{ ...body, lines, number, totalHT: Math.round(totalHT), totalTVA: Math.round(totalTVA), totalDTS, totalTTC, paidAmount: 0, tenantId: auth.tenantId, createdBy: auth.userId, status: "draft" }],
      { session }
    );

    // 2. Écriture comptable automatique (VT — journal Ventes)
    await AccountingEntryModel.create(
      [{
        tenantId: auth.tenantId,
        journalCode: "VT",
        entryDate: new Date(body.issueDate),
        reference: number,
        label: `Facture client ${client.name} — ${number}`,
        lines: [
          { accountCode: "411000", accountLabel: "Clients", debit: totalTTC, credit: 0, thirdPartyId: client._id },
          { accountCode: "706000", accountLabel: "Prestations de services", debit: 0, credit: Math.round(totalHT) },
          ...(totalTVA > 0 ? [{ accountCode: "443000", accountLabel: "TVA collectée", debit: 0, credit: Math.round(totalTVA) }] : []),
          ...(totalDTS > 0 ? [{ accountCode: "447000", accountLabel: "Droits de timbre", debit: 0, credit: totalDTS }] : []),
        ],
        linkedDocType: "invoice",
        linkedDocId: invoice._id,
        createdBy: auth.userId,
      }],
      { session }
    );

    return invoice;
  });

  await logAudit(auth, "CREATE", "invoices", {
    resourceId: result._id.toString(),
    after: { number, totalTTC, clientId: body.clientId },
  });

  return created(result);
});
