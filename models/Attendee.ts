import { Schema, model, models, Types } from "mongoose";

export interface IAttendee {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  eventId: Types.ObjectId;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  ticketTypeId?: Types.ObjectId;
  ticketTypeName?: string;
  amount: number;
  ticketCode: string; // code de secours (lecture manuelle)
  qrSig: string; // signature du billet (32 hex)
  status: "registered" | "paid" | "present" | "cancelled" | "refunded";
  paymentRef?: string;
  orderId?: string;
  paydunyaToken?: string;
  refundedAt?: Date;
  refundReason?: string;
  checkedInAt?: Date;
  checkedInBy?: Types.ObjectId;
  createdBy?: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

const AttendeeSchema = new Schema<IAttendee>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true, index: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true },
    phone: String,
    ticketTypeId: { type: Schema.Types.ObjectId },
    ticketTypeName: String,
    amount: { type: Number, default: 0, min: 0 },
    ticketCode: { type: String, required: true },
    qrSig: { type: String, required: true },
    status: {
      type: String,
      enum: ["registered", "paid", "present", "cancelled", "refunded"],
      default: "registered",
      index: true,
    },
    paymentRef: String,
    orderId: { type: String, index: true },
    paydunyaToken: String,
    refundedAt: Date,
    refundReason: String,
    checkedInAt: Date,
    checkedInBy: { type: Schema.Types.ObjectId, ref: "User" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// Unicité du code de secours par organisation ; recherche par événement/statut.
AttendeeSchema.index({ tenantId: 1, ticketCode: 1 }, { unique: true });
AttendeeSchema.index({ eventId: 1, status: 1 });

export const AttendeeModel = models.Attendee || model<IAttendee>("Attendee", AttendeeSchema);
