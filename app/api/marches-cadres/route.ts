import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, created, badRequest, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { FrameworkOrderModel } from "@/models/FrameworkOrder";
import { nextDocumentNumber } from "@/lib/numbering";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const GET = withAuth("commandes", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const p = getPagination(req);
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const clientId = url.searchParams.get("clientId");
  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  if (status) filter.status = status;
  if (clientId) filter.clientId = clientId;

  const [items, total] = await Promise.all([
    FrameworkOrderModel.find(filter).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit)
      .populate("clientId", "name code").lean(),
    FrameworkOrderModel.countDocuments(filter),
  ]);
  return paginatedResponse(items, total, p);
});

export const POST = withAuth("commandes", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const err = requireFields(body, ["clientId", "title", "totalQuantity", "unitPrice"]);
  if (err) return badRequest(err);

  const totalQuantity = Number(body.totalQuantity);
  const unitPrice = Number(body.unitPrice);
  if (!(totalQuantity >= 1) || !(unitPrice >= 0)) return badRequest("Quantité et prix unitaire invalides.");

  const reference = String(body.reference || "").trim()
    || await nextDocumentNumber(auth.tenantId, "order", { issueDate: body.startDate });

  const order = await FrameworkOrderModel.create({
    tenantId: auth.tenantId,
    reference,
    clientId: body.clientId,
    title: String(body.title).slice(0, 200),
    productId: body.productId || undefined,
    unit: String(body.unit || "unité").slice(0, 20),
    totalQuantity,
    unitPrice,
    tvaRate: body.tvaRate !== undefined ? Number(body.tvaRate) : 0.19,
    startDate: body.startDate ? new Date(body.startDate) : undefined,
    endDate: body.endDate ? new Date(body.endDate) : undefined,
    inputProductId: body.inputProductId || undefined,
    inputPerUnit: body.inputPerUnit !== undefined ? Number(body.inputPerUnit) : 1,
    status: ["draft", "active"].includes(body.status) ? body.status : "active",
    notes: body.notes,
    createdBy: auth.userId,
  });
  await logAudit(auth, "CREATE", "commandes", { resourceId: order._id.toString(), metadata: { type: "marche_cadre" } });
  return created(order);
});
