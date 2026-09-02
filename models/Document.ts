import { Schema, model, models } from "mongoose";
const DocumentSchema = new Schema({ tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true }, name: { type: String, required: true }, type: String, size: Number, url: { type: String, required: true }, checksum: String, linkedTo: { type: String }, linkedId: Schema.Types.ObjectId, uploadedBy: { type: Schema.Types.ObjectId, ref: "User" }, tags: [String], createdAt: { type: Date, default: Date.now } });
DocumentSchema.index({ tenantId: 1, linkedTo: 1, linkedId: 1 });
export const DocumentModel = models.Document || model("Document", DocumentSchema);
