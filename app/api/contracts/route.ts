import { nextDocumentNumber } from "@/lib/numbering";
import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { ContractModel } from "@/models/Contract";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("contracts", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const clientId = url.searchParams.get("clientId");
  const isRecurring = url.searchParams.get("isRecurring");
  const type = url.searchParams.get("type");

  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  if (status) filter.status = status;
  if (clientId) filter.clientId = clientId;
  if (type) filter.type = type;
  if (isRecurring !== null) filter.isRecurring = isRecurring === "true";

  const [items, total] = await Promise.all([
    ContractModel.find(filter)
      .populate("clientId", "name code")
      .populate("supplierId", "name code")
      .sort({ createdAt: -1 })
      .skip(pagination.skip).limit(pagination.limit).lean(),
    ContractModel.countDocuments(filter),
  ]);
  return paginatedResponse(items, total, pagination);
});

export const POST = withAuth("contracts", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json();
  const err = requireFields(body, ["title", "type"]);
  if (err) return badRequest(err);
  await connectDB();

  // Calculer la prochaine date de facturation pour les récurrents
  if (body.isRecurring && body.startDate && !body.nextBillingDate) {
    body.nextBillingDate = body.startDate;
  }

  const contract = await ContractModel.create({ ...body, tenantId: auth.tenantId, createdBy: auth.userId });
  await logAudit(auth, "CREATE", "contracts", {
    resourceId: contract._id.toString(),
    after: { reference: contract.reference, title: body.title, type: body.type, isRecurring: body.isRecurring },
  });
  return created(contract);
});
