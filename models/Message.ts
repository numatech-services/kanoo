import { Schema, model, models } from "mongoose";

const AttachmentSchema = new Schema({
  name:     { type: String, required: true },
  url:      { type: String, required: true },
  mimeType: String,
  size:     Number,   // octets
}, { _id: false });

const MessageSchema = new Schema({
  tenantId:       { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true, index: true },

  senderId:   { type: Schema.Types.ObjectId, ref: "User", required: true },
  senderName: { type: String },              // Dénormalisé pour affichage rapide

  content:     { type: String, required: true, trim: true, maxlength: 4000 },
  attachments: [AttachmentSchema],

  // Réponse à un message
  replyToId:      { type: Schema.Types.ObjectId, ref: "Message" },
  replyToContent: String,               // Extrait dénormalisé du message cité

  // Statut de lecture : tableau des IDs ayant lu
  readBy: [{ type: Schema.Types.ObjectId, ref: "User" }],

  isEdited:    { type: Boolean, default: false },
  editedAt:    Date,
  isDeleted:   { type: Boolean, default: false },
  deletedAt:   Date,
}, { timestamps: true });

MessageSchema.index({ conversationId: 1, createdAt: -1 });
MessageSchema.index({ tenantId: 1, senderId: 1 });

export const MessageModel = models.Message || model("Message", MessageSchema);
