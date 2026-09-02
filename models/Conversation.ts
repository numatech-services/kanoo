import { Schema, model, models } from "mongoose";

export type ConversationType =
  | "direct"          // entre deux utilisateurs
  | "group"           // groupe interne (équipe projet, bureau…)
  | "announcement"    // broadcast admin → membres (lecture seule pour destinataires)
  | "support";        // client → superadmin

const ConversationSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },

  type: {
    type: String,
    enum: ["direct", "group", "announcement", "support"],
    default: "direct",
  },

  // Titre (pour groupes et annonces)
  title: { type: String, trim: true },

  // Participants
  participantIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
  createdBy: { type: Schema.Types.ObjectId, ref: "User" },

  // Contexte optionnel (lier à un projet, un contrat, un marché…)
  linkedToType: { type: String, enum: ["project", "contract", "tender", "member", "employee", null] },
  linkedToId:   { type: Schema.Types.ObjectId },

  // Dernier message (pour affichage dans la liste)
  lastMessage: {
    content: String,
    senderId: { type: Schema.Types.ObjectId, ref: "User" },
    sentAt: Date,
  },

  // Compteurs non lus par participant : { userId: count }
  unreadCounts: { type: Map, of: Number, default: {} },

  isArchived: { type: Boolean, default: false },
  isMuted:    { type: Boolean, default: false },
}, { timestamps: true });

ConversationSchema.index({ tenantId: 1, participantIds: 1 });
ConversationSchema.index({ tenantId: 1, type: 1 });
ConversationSchema.index({ "lastMessage.sentAt": -1 });

export const ConversationModel = models.Conversation || model("Conversation", ConversationSchema);
