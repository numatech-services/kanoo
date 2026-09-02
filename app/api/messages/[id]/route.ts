import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest } from "@/lib/api-helpers";
import { MessageModel } from "@/models/Message";

// GET : Récupérer les messages d'une conversation
export const GET = withAuth("messages", "read", async (req: NextRequest, auth: any) => {
  await connectDB();
  const { searchParams } = new URL(req.url);
  const conversationId = searchParams.get("conversationId");

  if (!conversationId) return badRequest("ID de conversation manquant");

  const messages = await MessageModel.find({
    tenantId: auth.tenantId,
    conversationId,
    isDeleted: false
  })
  .sort({ createdAt: 1 }) // Ordre chronologique
  .limit(100);

  return ok(messages);
});

// POST : Envoyer un nouveau message
export const POST = withAuth("messages", "create", async (req: NextRequest, auth: any) => {
  await connectDB();
  const body = await req.json();

  const newMessage = await MessageModel.create({
    ...body,
    tenantId: auth.tenantId,
    senderId: auth.id,
    senderName: auth.name, // Utilise le nom de l'utilisateur connecté
    readBy: [auth.id]      // L'expéditeur l'a déjà lu
  });

  return NextResponse.json(newMessage, { status: 201 });
});