import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, sanitizeBody, created, badRequest, conflict, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { ProjectModel } from "@/models/Project";
import { ConversationModel } from "@/models/Conversation";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import { maskProjectMoney, stripProjectMoneyWrites } from "@/lib/payroll-mask";

export const GET = withAuth("projects", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const type = url.searchParams.get("projectType");
  const search = url.searchParams.get("search");

  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  if (status) filter.status = status;
  if (type) filter.projectType = type;
  if (search) filter.$or = [{ name: { $regex: search, $options: "i" } }, { code: { $regex: search, $options: "i" } }];

  const [items, total] = await Promise.all([
    ProjectModel.find(filter)
      .populate("managerId", "firstName lastName")
      .populate("clientId", "name code")
      .sort({ status: 1, updatedAt: -1 })
      .skip(pagination.skip).limit(pagination.limit).lean(),
    ProjectModel.countDocuments(filter),
  ]);

  return paginatedResponse(items.map(p => maskProjectMoney(p as Record<string, unknown>, auth)), total, pagination);
});

export const POST = withAuth("projects", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  // Corps assaini : ni tenantId ni opérateur Mongo, montants réservés aux finances.
  const body = stripProjectMoneyWrites(sanitizeBody(await req.json(), ["conversationId"]), auth);
  const err = requireFields(body, ["code", "name"]);
  if (err) return badRequest(err);

  const existing = await ProjectModel.findOne({ tenantId: auth.tenantId, code: body.code });
  if (existing) return conflict(`Code '${body.code}' déjà utilisé`);

  // Créer une conversation dédiée au projet
  const conv = await ConversationModel.create({
    tenantId: auth.tenantId,
    type: "group",
    title: `Projet ${body.code} — ${body.name}`,
    participantIds: [auth.userId, ...((Array.isArray(body.teamIds) ? body.teamIds : []) as string[])],
    createdBy: auth.userId,
  });

  const project = await ProjectModel.create({
    ...body,
    tenantId: auth.tenantId,
    conversationId: conv._id,
  });

  await logAudit(auth, "CREATE", "projects", { resourceId: project._id.toString(), after: { code: body.code, name: body.name } });
  return created(maskProjectMoney(project.toObject(), auth));
});
