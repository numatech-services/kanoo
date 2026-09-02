import { NextRequest } from "next/server";
import { withAuth, ok, created, badRequest, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { CommandeModel } from "@/models/Commande";
import { calculerTVA } from "@/lib/niger-fiscal";
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
    const ht = l.quantity * l.unitPrice;
    const tva = calculerTVA(ht, l.tvaRate ?? 0.19);
    totalHT += ht; totalTVA += tva;
    return { ...l, totalHT: Math.round(ht), totalTVA: Math.round(tva), totalTTC: Math.round(ht + tva) };
  });
  const year = new Date(body.orderDate).getFullYear();
  const count = await CommandeModel.countDocuments({ tenantId: auth.tenantId });
  const number = await nextDocumentNumber(auth.tenantId, "order");
  const commande = await CommandeModel.create({ ...body, lines, number, totalHT: Math.round(totalHT), totalTVA: Math.round(totalTVA), totalTTC: Math.round(totalHT + totalTVA), tenantId: auth.tenantId, status: "draft", createdBy: auth.userId });
  await logAudit(auth, "CREATE", "commandes", { resourceId: commande._id.toString(), after: { number } });
  return created(commande);
});
