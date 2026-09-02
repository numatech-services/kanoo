import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, forbidden, notFound } from "@/lib/api-helpers";
import { MessageModel } from "@/models/Message";
import { ConversationModel } from "@/models/Conversation";
import { UserModel } from "@/models/User";
import { TokenPayload } from "@/lib/auth";

/**
 * Vérifie que l'appelant participe bien à la conversation visée.
 *
 * Le filtre ne portait que sur `tenantId` : n'importe quel utilisateur de
 * l'organisation pouvait lire n'importe quelle conversation en devinant son
 * identifiant, y compris les échanges directs entre deux collègues.
 */
async function assertParticipant(auth: TokenPayload, conversationId: string) {
  const conversation = await ConversationModel.findOne({
    _id: conversationId,
    tenantId: auth.tenantId,
  }).select("participantIds type").lean<{
    participantIds?: Array<{ toString(): string }>;
    type?: string;
  } | null>();

  if (!conversation) return { ok: false as const, response: notFound("Conversation introuvable") };

  const participants = (conversation.participantIds || []).map(String);
  // Une annonce est diffusée à toute l'organisation : pas de liste nominative.
  if (conversation.type !== "announcement" && !participants.includes(auth.userId)) {
    return { ok: false as const, response: forbidden("Vous ne participez pas à cette conversation.") };
  }
  return { ok: true as const, conversation };
}

// GET : Récupérer les messages d'une conversation
export const GET = withAuth("messages", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const { searchParams } = new URL(req.url);
  const conversationId = searchParams.get("conversationId");

  if (!conversationId) return badRequest("ID de conversation manquant");

  const access = await assertParticipant(auth, conversationId);
  if (!access.ok) return access.response;

  const messages = await MessageModel.find({
    tenantId: auth.tenantId,
    conversationId,
    isDeleted: false,
  })
    .sort({ createdAt: 1 })
    .limit(100)
    .lean();

  return ok(messages);
});

// POST : Envoyer un nouveau message
export const POST = withAuth("messages", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json();

  const conversationId = String(body.conversationId || "");
  const content = String(body.content || "").trim();
  if (!conversationId) return badRequest("ID de conversation manquant");
  if (!content) return badRequest("Le message est vide");

  const access = await assertParticipant(auth, conversationId);
  if (!access.ok) return access.response;

  // `auth.id` et `auth.name` n'existent pas sur le jeton — les champs sont
  // `userId` et `email`. `senderId` étant obligatoire dans le schéma, chaque
  // envoi levait une erreur de validation : la messagerie n'a jamais fonctionné.
  const sender = await UserModel.findById(auth.userId)
    .select("firstName lastName")
    .lean<{ firstName?: string; lastName?: string } | null>();

  const senderName = sender
    ? `${sender.firstName ?? ""} ${sender.lastName ?? ""}`.trim() || auth.email
    : auth.email;

  // Le corps était recopié tel quel : un client pouvait poser isDeleted,
  // readBy ou un senderId d'emprunt.
  const message = await MessageModel.create({
    tenantId: auth.tenantId,
    conversationId,
    content,
    attachments: Array.isArray(body.attachments) ? body.attachments : undefined,
    replyToId: body.replyToId || undefined,
    replyToContent: body.replyToContent || undefined,
    senderId: auth.userId,
    senderName,
    readBy: [auth.userId],
  });

  // Le dernier message alimente la liste des conversations : sans cette mise à
  // jour, elle affichait indéfiniment un aperçu vide.
  await ConversationModel.updateOne(
    { _id: conversationId, tenantId: auth.tenantId },
    { $set: { lastMessage: { content, senderId: auth.userId, sentAt: new Date() } } }
  );

  return created(message);
});
