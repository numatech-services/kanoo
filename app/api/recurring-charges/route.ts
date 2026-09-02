import { NextRequest } from "next/server";
import { withAuth, ok, created, badRequest, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { Schema, model, models } from "mongoose";
import { TokenPayload } from "@/lib/auth";
const RCSchema = new Schema({ tenantId: { type: Schema.Types.ObjectId, required: true, index: true }, label: { type: String, required: true }, amount: { type: Number, required: true }, frequency: { type: String, enum: ["monthly","quarterly","yearly"], default: "monthly" }, nextDueDate: Date, accountCode: String, supplierId: Schema.Types.ObjectId, isActive: { type: Boolean, default: true } }, { timestamps: true });
const RCModel = models.RecurringCharge || model("RecurringCharge", RCSchema);
export const GET = withAuth("recurringCharges", "read", async (req: NextRequest, auth: TokenPayload) => {
  const pagination = getPagination(req);
  const [items, total] = await Promise.all([RCModel.find({ ...tenantFilter(auth), isActive: true }).sort({ nextDueDate: 1 }).skip(pagination.skip).limit(pagination.limit).lean(), RCModel.countDocuments({ ...tenantFilter(auth), isActive: true })]);
  return paginatedResponse(items, total, pagination);
});
export const POST = withAuth("recurringCharges", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json();
  const err = requireFields(body, ["label", "amount", "frequency"]);
  if (err) return badRequest(err);
  const charge = await RCModel.create({ ...body, tenantId: auth.tenantId });
  return created(charge);
});
