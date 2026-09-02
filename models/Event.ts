import { Schema, model, models, Types } from "mongoose";

export interface ITicketType {
  _id?: Types.ObjectId;
  name: string;
  price: number;
  quantity: number;
  salesStart?: Date;
  salesEnd?: Date;
}

export interface IEvent {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  title: string;
  description?: string;
  coverImage?: string;
  category?: string;
  tags: string[];
  startAt: Date;
  endAt?: Date;
  timezone: string;
  locationType: "physical" | "online";
  address?: string;
  lat?: number;
  lng?: number;
  meetingLink?: string;
  capacity: number; // 0 = illimité
  visibility: "public" | "private";
  isPaid: boolean;
  ticketTypes: ITicketType[];
  status: "draft" | "published" | "cancelled" | "completed";
  sendConfirmation: boolean;
  reminderHoursBefore?: number;
  createdBy: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

const TicketTypeSchema = new Schema<ITicketType>(
  {
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0, default: 0 },
    quantity: { type: Number, required: true, min: 0, default: 0 }, // 0 = illimité
    salesStart: Date,
    salesEnd: Date,
  },
  { _id: true }
);

const EventSchema = new Schema<IEvent>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: String,
    coverImage: String,
    category: String,
    tags: { type: [String], default: [] },
    startAt: { type: Date, required: true },
    endAt: Date,
    timezone: { type: String, default: "Africa/Niamey" },
    locationType: { type: String, enum: ["physical", "online"], default: "physical" },
    address: String,
    lat: Number,
    lng: Number,
    meetingLink: String,
    capacity: { type: Number, default: 0, min: 0 },
    visibility: { type: String, enum: ["public", "private"], default: "public" },
    isPaid: { type: Boolean, default: false },
    ticketTypes: { type: [TicketTypeSchema], default: [] },
    status: {
      type: String,
      enum: ["draft", "published", "cancelled", "completed"],
      default: "draft",
      index: true,
    },
    sendConfirmation: { type: Boolean, default: true },
    reminderHoursBefore: { type: Number, default: 24 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

EventSchema.index({ tenantId: 1, startAt: -1 });
EventSchema.index({ tenantId: 1, status: 1 });

export const EventModel = models.Event || model<IEvent>("Event", EventSchema);
