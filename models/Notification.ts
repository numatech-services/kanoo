import { Schema, model, models } from "mongoose";
const NotificationSchema = new Schema({ tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true }, userId: { type: Schema.Types.ObjectId, ref: "User", required: true }, type: { type: String, required: true }, title: String, message: String, channel: { type: String, enum: ["app","email","sms"], default: "app" }, read: { type: Boolean, default: false }, linkedTo: String, linkedId: Schema.Types.ObjectId, createdAt: { type: Date, default: Date.now, index: true } });
NotificationSchema.index({ tenantId: 1, userId: 1, read: 1 });
export const NotificationModel = models.Notification || model("Notification", NotificationSchema);
