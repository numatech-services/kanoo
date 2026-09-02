import { Schema, model, models } from "mongoose";
import { IMember } from "@/types";
const MemberSchema = new Schema<IMember>({ tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true }, code: { type: String, required: true }, firstName: { type: String, required: true }, lastName: { type: String, required: true }, email: String, phone: String, membershipType: { type: String, required: true }, joinDate: { type: Date, required: true }, status: { type: String, enum: ["active","inactive","suspended","expelled"], default: "active" }, portalPassword: String,
  accessCode: { type: String, index: true },
  accessCodeGeneratedAt: Date,
  accessCodeSentAt: Date,
}, { timestamps: true });
MemberSchema.index({ tenantId: 1, code: 1 }, { unique: true });
export const MemberModel = models.Member || model<IMember>("Member", MemberSchema);
