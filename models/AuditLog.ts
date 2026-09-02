import { Schema, model, models } from "mongoose";
const AuditLogSchema = new Schema({ tenantId: Schema.Types.ObjectId, userId: Schema.Types.ObjectId, userEmail: String, userRole: String, action: { type: String, required: true }, resource: { type: String, required: true }, resourceId: Schema.Types.ObjectId, before: Schema.Types.Mixed, after: Schema.Types.Mixed, ip: String, userAgent: String, metadata: Schema.Types.Mixed, createdAt: { type: Date, default: Date.now, index: true } }, { _id: true });
AuditLogSchema.index({ tenantId: 1, createdAt: -1 });
AuditLogSchema.index({ tenantId: 1, resource: 1 });
export const AuditLogModel = models.AuditLog || model("AuditLog", AuditLogSchema);
