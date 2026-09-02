import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { getTokenFromRequest, verifyToken } from "@/lib/auth";
import { generateApiKey, hashApiKey } from "@/lib/api-key";
import { Schema, model, models } from "mongoose";

const ApiKeySchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
  userId: Schema.Types.ObjectId,
  name: { type: String, required: true },
  keyHash: { type: String, required: true, unique: true },
  keyPrefix: String,
  scopes: [String],
  isActive: { type: Boolean, default: true },
  lastUsedAt: Date,
  expiresAt: Date,
  requestCount: { type: Number, default: 0 },
}, { timestamps: true });

const ApiKeyModel = models.ApiKey || model("ApiKey", ApiKeySchema);

// POST /api/v1/auth — Générer une clé API (nécessite auth session)
export async function POST(req: NextRequest) {
  const token = getTokenFromRequest(req);
  if (!token) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  let auth;
  try { auth = verifyToken(token); } catch { return NextResponse.json({ error: "Token invalide" }, { status: 401 }); }

  await connectDB();
  const body = await req.json().catch(() => ({}));

  const { key, hash, prefix } = generateApiKey();

  await ApiKeyModel.create({
    tenantId: auth.tenantId, userId: auth.userId,
    name: body.name || "Clé API par défaut",
    keyHash: hash, keyPrefix: prefix,
    scopes: body.scopes || ["invoices:read", "clients:read"],
    expiresAt: body.expiresAt || new Date(Date.now() + 365 * 86400000),
  });

  return NextResponse.json({
    success: true,
    data: {
      key, // Affiché UNE SEULE FOIS
      prefix,
      warning: "⚠ Cette clé ne sera plus affichée. Conservez-la dans un endroit sécurisé.",
      scopes: body.scopes || ["invoices:read", "clients:read"],
      docs: "https://docs.kanoo.ne/api/v1",
    }
  }, { status: 201 });
}

// GET /api/v1/auth — Lister les clés (sans les valeurs)
export async function GET(req: NextRequest) {
  const token = getTokenFromRequest(req);
  if (!token) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  let auth;
  try { auth = verifyToken(token); } catch { return NextResponse.json({ error: "Token invalide" }, { status: 401 }); }

  await connectDB();
  const keys = await ApiKeyModel.find({ tenantId: auth.tenantId }).select("-keyHash").lean();
  return NextResponse.json({ success: true, data: keys });
}
