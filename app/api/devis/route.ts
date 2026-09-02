import { NextRequest } from "next/server";
import { withAuth, ok, created, badRequest, notFound, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { DevisModel } from "@/models/Devis";
import { InvoiceModel } from "@/models/Invoice";
import { calculerTVA, calculerDTS } from "@/lib/niger-fiscal";
import { nextDocumentNumber } from "@/lib/numbering";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("devis", "read", async (req: NextRequest, auth: TokenPayload) => {
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  if (status) filter.status = status;
  const [items, total] = await Promise.all([
    DevisModel.find(filter).populate("clientId", "name code").sort({ issueDate: -1 }).skip(pagination.skip).limit(pagination.limit).lean(),
    DevisModel.countDocuments(filter),
  ]);
  return paginatedResponse(items, total, pagination);
});

export const POST = withAuth("devis", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json();
  const err = requireFields(body, ["clientId", "lines", "issueDate", "validUntil"]);
  if (err) return badRequest(err);
  let totalHT = 0, totalTVA = 0;
  const lines = body.lines.map((l: { description: string; quantity: number; unitPrice: number; tvaRate?: number; discount?: number }) => {
    const ht = l.quantity * l.unitPrice * (1 - (l.discount || 0) / 100);
    const tva = calculerTVA(ht, l.tvaRate ?? 0.19);
    totalHT += ht; totalTVA += tva;
    return { ...l, totalHT: Math.round(ht), totalTVA: Math.round(tva), totalTTC: Math.round(ht + tva) };
  });
  const year = new Date(body.issueDate).getFullYear();
  const number = await nextDocumentNumber(auth.tenantId, "quote");
  const devis = await DevisModel.create({ ...body, lines, number, totalHT: Math.round(totalHT), totalTVA: Math.round(totalTVA), totalTTC: Math.round(totalHT + totalTVA), tenantId: auth.tenantId, createdBy: auth.userId });
  await logAudit(auth, "CREATE", "devis", { resourceId: devis._id.toString(), after: { number } });
  return created(devis);
});
