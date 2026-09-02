import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { ConversationModel } from "@/models/Conversation";
import { UserModel } from "@/models/User";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("messages", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const type = url.searchParams.get("type");

  const filter: Record<string, unknown> = {
    tenantId: auth.tenantId,
    participantIds: auth.userId,   
    isArchived: false,
  };
  if (type) filter.type = type;

  const [items, total] = await Promise.all([
    ConversationModel.find(filter)
      .populate("participantIds", "firstName lastName role")
      .populate("createdBy", "firstName lastName")
      .sort({ "lastMessage.sentAt": -1, updatedAt: -1 })
      .skip(pagination.skip).limit(pagination.limit).lean(),
    ConversationModel.countDocuments(filter),
  ]);

  return paginatedResponse(items, total, pagination);
});

export const POST = withAuth("messages", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json();
  const err = requireFields(body, ["type"]);
  if (err) return badRequest(err);

  // Pour les conversations directes, vérifier que l'autre participant existe
  if (body.type === "direct" && body.participantIds?.length !== 1) {
    return badRequest("Une conversation directe nécessite exactement 1 autre participant");
  }

  // Vérifier qu'une conversation directe n'existe pas déjà
  if (body.type === "direct") {
    const existing = await ConversationModel.findOne({
      tenantId: auth.tenantId, type: "direct",
      participantIds: { $all: [auth.userId, body.participantIds[0]] },
    });
    if (existing) return ok(existing);
  }

  const participants = [auth.userId, ...(body.participantIds || [])];

  const conversation = await ConversationModel.create({
    ...body,
    tenantId: auth.tenantId,
    participantIds: participants,
    createdBy: auth.userId,
  });

  return created(conversation);
});
