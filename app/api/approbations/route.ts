import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import {
  withAuth, ok, created, badRequest, notFound, forbidden,
  getPagination, paginatedResponse, tenantFilter, requireFields
} from "@/lib/api-helpers";
import { ApprobationModel } from "@/models/Approbation";
import { NotificationModel } from "@/models/Notification";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("approbations", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const resource = url.searchParams.get("resource");
  const mine = url.searchParams.get("mine") === "true";

  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  if (status) filter.status = status;
  if (resource) filter.resource = resource;
  // Filtrer les approbations où l'utilisateur est approver en attente
  if (mine) {
    filter["approvers"] = {
      $elemMatch: {
        userId: auth.userId,
        status: "pending",
      },
    };
  }

  const [items, total] = await Promise.all([
    ApprobationModel.find(filter)
      .populate("requestedBy", "firstName lastName email")
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    ApprobationModel.countDocuments(filter),
  ]);

  return paginatedResponse(items, total, pagination);
});

// POST — Créer une demande d'approbation
export const POST = withAuth("approbations", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json();
  const missing = requireFields(body, ["resource", "resourceId", "approvers"]);
  if (missing) return badRequest(missing);

  await connectDB();

  const approbation = await ApprobationModel.create({
    tenantId: auth.tenantId,
    resource: body.resource,
    resourceId: body.resourceId,
    requestedBy: auth.userId,
    amount: body.amount,
    notes: body.notes,
    status: "pending",
    currentLevel: 1,
    approvers: body.approvers.map((a: { userId: string; level: number }) => ({
      userId: a.userId,
      level: a.level,
      status: "pending",
    })),
  });

  // Notifier le premier approbateur
  const firstApprover = body.approvers.find((a: { level: number }) => a.level === 1);
  if (firstApprover) {
    await NotificationModel.create({
      tenantId: auth.tenantId,
      userId: firstApprover.userId,
      type: "approval_request",
      title: "Nouvelle demande d'approbation",
      message: `Une demande d'approbation vous attend sur ${body.resource}`,
      linkedTo: "approbations",
      linkedId: approbation._id,
    });
  }

  await logAudit(auth, "CREATE", "approbations", {
    resourceId: approbation._id.toString(),
    after: { resource: body.resource, resourceId: body.resourceId },
  });

  return created(approbation);
});
