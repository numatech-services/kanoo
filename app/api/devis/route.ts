import { NextRequest } from "next/server";
import { withTransaction } from "@/lib/db";
import { withAuth, ok, created, badRequest, notFound, getPagination, paginatedResponse, tenantFilter, requireFields, sanitizeBody } from "@/lib/api-helpers";
import { DevisModel } from "@/models/Devis";
import { InvoiceModel } from "@/models/Invoice";
import { calculerTVA, calculerDTS, TVA_TAUX_STANDARD } from "@/lib/niger-fiscal";
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
  // Totaux : somme des lignes arrondies, pour que le pied corresponde à
  // l'addition des lignes imprimées.
  let totalHT = 0, totalTVA = 0;
  const lines = body.lines.map((l: { description: string; quantity: number; unitPrice: number; tvaRate?: number; discount?: number }) => {
    const lineHT = Math.round(l.quantity * l.unitPrice * (1 - (l.discount || 0) / 100));
    const lineTVA = calculerTVA(lineHT, l.tvaRate ?? TVA_TAUX_STANDARD);
    totalHT += lineHT; totalTVA += lineTVA;
    return { ...l, totalHT: lineHT, totalTVA: lineTVA, totalTTC: lineHT + lineTVA };
  });

  const devis = await withTransaction(async (session) => {
    const number = await nextDocumentNumber(auth.tenantId, "quote", { issueDate: body.issueDate, session });
    const [doc] = await DevisModel.create([{
      ...sanitizeBody(body, ["number", "status", "totalHT", "totalTVA", "totalTTC"]),
      lines, number, totalHT, totalTVA, totalTTC: totalHT + totalTVA,
      tenantId: auth.tenantId, createdBy: auth.userId,
    }], { session });
    return doc;
  });

  await logAudit(auth, "CREATE", "devis", { resourceId: devis._id.toString(), after: { number: devis.number } });
  return created(devis);
});
