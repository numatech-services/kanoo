import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "./db";
import { getApiKeyFromRequest, hashApiKey } from "./api-key";
import { Schema, model, models } from "mongoose";

const ApiKeySchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, required: true },
  keyHash: { type: String, required: true, unique: true },
  scopes: [String],
  isActive: { type: Boolean, default: true },
  expiresAt: Date,
  requestCount: { type: Number, default: 0 },
}, { timestamps: true });
const ApiKeyModel = models.ApiKey || model("ApiKey", ApiKeySchema);

export interface ApiV1Context {
  tenantId: string;
  scopes: string[];
}

export async function validateApiKey(req: NextRequest): Promise<{ context: ApiV1Context } | { error: NextResponse }> {
  const rawKey = getApiKeyFromRequest(req);
  if (!rawKey) return { error: NextResponse.json({ error: "Clé API manquante. Utilisez: Authorization: Bearer kno_xxx" }, { status: 401 }) };

  await connectDB();
  const hash = hashApiKey(rawKey);
  const apiKey = await ApiKeyModel.findOne({ keyHash: hash, isActive: true });

  if (!apiKey) return { error: NextResponse.json({ error: "Clé API invalide ou désactivée" }, { status: 401 }) };
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) return { error: NextResponse.json({ error: "Clé API expirée" }, { status: 401 }) };

  // Incrémenter le compteur de requêtes
  await ApiKeyModel.findByIdAndUpdate(apiKey._id, { $inc: { requestCount: 1 }, lastUsedAt: new Date() });

  return { context: { tenantId: apiKey.tenantId.toString(), scopes: apiKey.scopes } };
}
