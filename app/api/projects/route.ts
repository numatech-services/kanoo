import { NextRequest } from "next/server";
import { projectScope } from "@/lib/project-scope";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, sanitizeBody, created, badRequest, conflict, getPagination, paginatedResponse, tenantFilter, requireFields, escapeRegex } from "@/lib/api-helpers";
import { ProjectModel } from "@/models/Project";
import { ConversationModel } from "@/models/Conversation";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import { maskProjectMoney, stripProjectMoneyWrites } from "@/lib/payroll-mask";
import { projectFinance } from "@/lib/project-finance";
import { hasFinanceAccess } from "@/lib/role-resources";
import { checkProjectRefs } from "@/lib/project-refs";

export const GET = withAuth("projects", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const type = url.searchParams.get("projectType");
  const search = escapeRegex(url.searchParams.get("search"));

  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  // Raccourci « Voir les … » de la fiche client.
  const clientId = url.searchParams.get("clientId");
  if (clientId && Types.ObjectId.isValid(clientId)) filter.clientId = new Types.ObjectId(clientId);
  if (status) filter.status = status;
  if (type) filter.projectType = type;
  if (search) filter.$or = [{ name: { $regex: search, $options: "i" } }, { code: { $regex: search, $options: "i" } }];
  const scope = projectScope(auth);
  if (scope.$or) filter.$and = [{ $or: scope.$or }];

  const [items, total] = await Promise.all([
    ProjectModel.find(filter)
      .populate("managerId", "firstName lastName")
      .populate("clientId", "name code")
      .sort({ status: 1, updatedAt: -1 })
      .skip(pagination.skip).limit(pagination.limit).lean(),
    ProjectModel.countDocuments(filter),
  ]);

  if (!hasFinanceAccess(auth)) return paginatedResponse(items.map(p => maskProjectMoney(p as Record<string, unknown>, auth)), total, pagination);
  const fin = await projectFinance(auth.tenantId, items.map(p => p._id));
  return paginatedResponse(items.map(p => ({ ...p, finance: fin.get(String(p._id)) ?? { cost: 0, revenue: 0, margin: 0 } })), total, pagination);
});

export const POST = withAuth("projects", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  // Corps assaini : ni tenantId ni opérateur Mongo, montants réservés aux finances.
  const body = stripProjectMoneyWrites(sanitizeBody(await req.json(), ["conversationId"]), auth);
  const err = requireFields(body, ["code", "name"]);
  if (err) return badRequest(err);

  const refErr = await checkProjectRefs(auth.tenantId, body);
  if (refErr) return badRequest(refErr);

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

  // Le créateur fait partie de l'équipe : il retrouve son projet même s'il n'en est pas le responsable.
  const teamIds = [...new Set([...(Array.isArray(body.teamIds) ? (body.teamIds as unknown[]).map(String) : []), auth.userId])];
  const project = await ProjectModel.create({
    ...body,
    teamIds,
    tenantId: auth.tenantId,
    conversationId: conv._id,
  });

  await logAudit(auth, "CREATE", "projects", { resourceId: project._id.toString(), after: { code: body.code, name: body.name } });
  return created(maskProjectMoney(project.toObject(), auth));
});
