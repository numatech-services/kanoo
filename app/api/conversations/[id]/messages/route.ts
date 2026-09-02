import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { MessageModel } from "@/models/Message";
import { ConversationModel } from "@/models/Conversation";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("messages", "read", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") || "50");
  const before = url.searchParams.get("before"); // cursor pagination

  const filter: Record<string, unknown> = {
    conversationId: params.id,
    tenantId: auth.tenantId,
    isDeleted: false,
  };
  if (before) filter.createdAt = { $lt: new Date(before) };

  const messages = await MessageModel.find(filter)
    .populate("senderId", "firstName lastName role")
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  // Marquer comme lu
  await MessageModel.updateMany(
    { conversationId: params.id, tenantId: auth.tenantId, readBy: { $ne: auth.userId } },
    { $addToSet: { readBy: auth.userId } }
  );
  await ConversationModel.findByIdAndUpdate(params.id, {
    $set: { [`unreadCounts.${auth.userId}`]: 0 }
  });

  return ok(messages.reverse()); // Plus ancien en premier
});

export const POST = withAuth("messages", "create", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json();
  if (!body.content?.trim()) return badRequest("Le contenu du message ne peut pas être vide");

  const conversation = await ConversationModel.findOne({
    _id: params.id,
    tenantId: auth.tenantId,
    participantIds: auth.userId,
  });
  if (!conversation) return notFound("Conversation introuvable ou accès refusé");

  const message = await MessageModel.create({
    ...body,
    conversationId: params.id,
    tenantId: auth.tenantId,
    senderId: auth.userId,
    readBy: [auth.userId],
  });

  // Mettre à jour le dernier message et les compteurs non lus
  const unreadUpdate: Record<string, unknown> = { "lastMessage.content": body.content.slice(0, 100), "lastMessage.senderId": auth.userId, "lastMessage.sentAt": new Date() };
  for (const pid of conversation.participantIds) {
    if (pid.toString() !== auth.userId) {
      unreadUpdate[`unreadCounts.${pid}`] = (conversation.unreadCounts?.get?.(pid.toString()) || 0) + 1;
    }
  }
  await ConversationModel.findByIdAndUpdate(params.id, { $set: unreadUpdate });

  const populated = await MessageModel.findById(message._id).populate("senderId", "firstName lastName role").lean();
  return created(populated);
});
