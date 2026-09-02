import { NextRequest } from "next/server";
import { withTransaction } from "@/lib/db";
import { withAuth, ok, created, badRequest, getPagination, paginatedResponse, tenantFilter, requireFields, sanitizeBody } from "@/lib/api-helpers";
import { CommandeModel } from "@/models/Commande";
import { calculerTVA, TVA_TAUX_STANDARD } from "@/lib/niger-fiscal";
import { nextDocumentNumber } from "@/lib/numbering";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("commandes", "read", async (req: NextRequest, auth: TokenPayload) => {
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  if (status) filter.status = status;
  const [items, total] = await Promise.all([
    CommandeModel.find(filter).populate("supplierId", "name code").sort({ orderDate: -1 }).skip(pagination.skip).limit(pagination.limit).lean(),
    CommandeModel.countDocuments(filter),
  ]);
  return paginatedResponse(items, total, pagination);
});

export const POST = withAuth("commandes", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json();
  const err = requireFields(body, ["supplierId", "lines", "orderDate"]);
  if (err) return badRequest(err);
  let totalHT = 0, totalTVA = 0;
  const lines = body.lines.map((l: { description: string; quantity: number; unitPrice: number; tvaRate?: number }) => {
    const lineHT = Math.round(l.quantity * l.unitPrice);
    const lineTVA = calculerTVA(lineHT, l.tvaRate ?? TVA_TAUX_STANDARD);
    totalHT += lineHT; totalTVA += lineTVA;
    return { ...l, totalHT: lineHT, totalTVA: lineTVA, totalTTC: lineHT + lineTVA };
  });

  const commande = await withTransaction(async (session) => {
    const number = await nextDocumentNumber(auth.tenantId, "order", { issueDate: body.orderDate, session });
    const [doc] = await CommandeModel.create([{
      ...sanitizeBody(body, ["number", "status", "totalHT", "totalTVA", "totalTTC"]),
      lines, number, totalHT, totalTVA, totalTTC: totalHT + totalTVA,
      tenantId: auth.tenantId, status: "draft", createdBy: auth.userId,
    }], { session });
    return doc;
  });

  await logAudit(auth, "CREATE", "commandes", { resourceId: commande._id.toString(), after: { number: commande.number } });
  return created(commande);
});
