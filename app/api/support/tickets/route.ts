import { NextRequest } from "next/server";
import { withAuth, ok, created, badRequest, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { Schema, model, models } from "mongoose";
import { TokenPayload } from "@/lib/auth";
const TicketSchema = new Schema({ tenantId: Schema.Types.ObjectId, userId: { type: Schema.Types.ObjectId, required: true }, subject: { type: String, required: true }, message: { type: String, required: true }, priority: { type: String, enum: ["low","medium","high","critical"], default: "medium" }, status: { type: String, enum: ["open","in_progress","resolved","closed"], default: "open" }, responses: [{ userId: Schema.Types.ObjectId, message: String, createdAt: { type: Date, default: Date.now } }] }, { timestamps: true });
const TicketModel = models.SupportTicket || model("SupportTicket", TicketSchema);
export const GET = withAuth("supportTickets", "read", async (req: NextRequest, auth: TokenPayload) => {
  const pagination = getPagination(req);
  const filter = auth.role === "superadmin" ? {} : tenantFilter(auth);
  const [items, total] = await Promise.all([TicketModel.find(filter).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit).lean(), TicketModel.countDocuments(filter)]);
  return paginatedResponse(items, total, pagination);
});
export const POST = withAuth("supportTickets", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json();
  const err = requireFields(body, ["subject", "message"]);
  if (err) return badRequest(err);
  const ticket = await TicketModel.create({ ...body, tenantId: auth.tenantId, userId: auth.userId });
  return created(ticket);
});
