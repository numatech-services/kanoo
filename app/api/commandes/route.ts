import { NextRequest } from "next/server";
import { withTransaction } from "@/lib/db";
import { withAuth, created, badRequest, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { CommandeModel } from "@/models/Commande";
import { SupplierModel } from "@/models/Supplier";
import { buildCommandeLines } from "@/lib/commande";
import { pickImputation, checkImputations } from "@/lib/imputation";
import { nextDocumentNumber } from "@/lib/numbering";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import { searchCondition, withSearch } from "@/lib/list-search";

export const GET = withAuth("commandes", "read", async (req: NextRequest, auth: TokenPayload) => {
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  if (status) filter.status = status;
  withSearch(filter, await searchCondition(auth.tenantId, url.searchParams.get("search"), { fields: ["number", "lines.description"], supplier: "supplierId" }));
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
  const supplierOk = await SupplierModel.exists({ ...tenantFilter(auth), _id: body.supplierId });
  if (!supplierOk) return badRequest("Fournisseur introuvable.");
  const built = await buildCommandeLines(auth.tenantId, body.lines);
  if ("error" in built) return badRequest(built.error as string);
  const imp = pickImputation(body);
  const impErr = await checkImputations(auth.tenantId, [imp]);
  if (impErr) return badRequest(impErr);

  const commande = await withTransaction(async (session) => {
    const number = await nextDocumentNumber(auth.tenantId, "order", { issueDate: body.orderDate, session });
    const [doc] = await CommandeModel.create([{
      supplierId: body.supplierId, orderDate: body.orderDate,
      expectedDeliveryDate: body.expectedDeliveryDate || undefined, notes: body.notes,
      ...imp,
      lines: built.lines.map(l => ({ ...l, receivedQty: 0 })), number,
      totalHT: built.totalHT, totalTVA: built.totalTVA, totalTTC: built.totalTTC,
      tenantId: auth.tenantId, status: "draft", createdBy: auth.userId,
    }], { session });
    return doc;
  });

  await logAudit(auth, "CREATE", "commandes", { resourceId: commande._id.toString(), after: { number: commande.number } });
  return created(commande);
});
