import { Schema, model, models, Types } from "mongoose";

/**
 * Bon de transfert entre deux restaurants : marchandise sortie de la réserve
 * de l'un vers la réserve de l'autre (lots et coût conservés), signé par qui
 * l'envoie, puis par qui le reçoit (avec un écart éventuel signalé).
 */
export interface IDeskTransfer {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  number: string;
  fromDeskId: Types.ObjectId; fromName: string;
  toDeskId: Types.ObjectId; toName: string;
  lines: Array<{ fromItemId: Types.ObjectId; toItemId: Types.ObjectId; productId: Types.ObjectId; name: string; unit: string; quantity: number; unitCost: number; lots: Array<{ lotNumber: string; qty: number; expiryDate?: Date }> }>;
  value: number;
  status: "sent" | "received";
  sentBy: Types.ObjectId; senderName: string; senderSignature: string; sentAt: Date;
  receivedBy?: Types.ObjectId; receiverName?: string; receiverSignature?: string; receivedAt?: Date; gapNote?: string;
  note?: string;
}

// Signature dessinée : image PNG en data-URI, bornée (~150 Ko).
const SIG = { type: String, maxlength: 200_000, match: /^data:image\/png;base64,[A-Za-z0-9+/=]+$/ };
const DeskTransferSchema = new Schema<IDeskTransfer>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
  number: { type: String, required: true },
  fromDeskId: { type: Schema.Types.ObjectId, ref: "ActivityDesk", required: true }, fromName: String,
  toDeskId: { type: Schema.Types.ObjectId, ref: "ActivityDesk", required: true }, toName: String,
  lines: [{ _id: false, fromItemId: Schema.Types.ObjectId, toItemId: Schema.Types.ObjectId, productId: Schema.Types.ObjectId, name: String, unit: String, quantity: Number, unitCost: Number,
    lots: [{ _id: false, lotNumber: String, qty: Number, expiryDate: Date }] }],
  value: { type: Number, default: 0 },
  status: { type: String, enum: ["sent", "received"], default: "sent" },
  sentBy: { type: Schema.Types.ObjectId, ref: "User", required: true }, senderName: { type: String, required: true, maxlength: 120 }, senderSignature: { ...SIG, required: true }, sentAt: { type: Date, required: true },
  receivedBy: { type: Schema.Types.ObjectId, ref: "User" }, receiverName: { type: String, maxlength: 120 }, receiverSignature: SIG, receivedAt: Date, gapNote: { type: String, maxlength: 400 },
  note: { type: String, maxlength: 300 },
}, { timestamps: true });

DeskTransferSchema.index({ tenantId: 1, number: 1 }, { unique: true });
DeskTransferSchema.index({ tenantId: 1, fromDeskId: 1, sentAt: -1 });
DeskTransferSchema.index({ tenantId: 1, toDeskId: 1, status: 1, sentAt: -1 });

export const DeskTransferModel = models.DeskTransfer || model<IDeskTransfer>("DeskTransfer", DeskTransferSchema);
