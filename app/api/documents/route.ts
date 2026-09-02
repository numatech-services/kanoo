import { NextRequest } from "next/server";
import { withAuth, ok, created, badRequest, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { DocumentModel } from "@/models/Document";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("documents", "read", async (req: NextRequest, auth: TokenPayload) => {
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const linkedTo = url.searchParams.get("linkedTo");
  const linkedId = url.searchParams.get("linkedId");
  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  if (linkedTo) filter.linkedTo = linkedTo;
  if (linkedId) filter.linkedId = linkedId;
  const [items, total] = await Promise.all([
    DocumentModel.find(filter).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit).lean(),
    DocumentModel.countDocuments(filter),
  ]);
  return paginatedResponse(items, total, pagination);
});

export const POST = withAuth("documents", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json();
  const err = requireFields(body, ["name", "url"]);
  if (err) return badRequest(err);
  const doc = await DocumentModel.create({ ...body, tenantId: auth.tenantId, uploadedBy: auth.userId });
  await logAudit(auth, "CREATE", "documents", { resourceId: doc._id.toString(), after: { name: body.name } });
  return created(doc);
});
