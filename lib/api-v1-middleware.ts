import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "./db";
import { getApiKeyFromRequest, hashApiKey } from "./api-key";
import { consumeRateLimit } from "./rate-limit";
import { ApiKeyModel } from "@/models/ApiKey";

export interface ApiV1Context {
  tenantId: string;
  scopes: string[];
  keyId: string;
  /** Créateur de la clé : auteur des écritures passées par l'API. */
  userId?: string;
  /** Clé du comptoir : le seul comptoir accessible. */
  deskId?: string;
}

/** Requêtes par minute et par clé (une caisse qui rattrape un retard envoie des lots, pas des milliers d'appels). */
const PER_MINUTE = 600;

export async function validateApiKey(req: NextRequest): Promise<{ context: ApiV1Context } | { error: NextResponse }> {
  const rawKey = getApiKeyFromRequest(req);
  if (!rawKey) return { error: NextResponse.json({ error: "Clé API manquante. Utilisez: Authorization: Bearer kno_xxx" }, { status: 401 }) };

  await connectDB();
  const hash = hashApiKey(rawKey);
  const apiKey = await ApiKeyModel.findOne({ keyHash: hash, isActive: true })
    .lean<{ _id: unknown; tenantId: unknown; scopes?: string[]; userId?: unknown; deskId?: unknown; expiresAt?: Date } | null>();

  if (!apiKey) return { error: NextResponse.json({ error: "Clé API invalide ou désactivée" }, { status: 401 }) };
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) return { error: NextResponse.json({ error: "Clé API expirée" }, { status: 401 }) };

  const limit = await consumeRateLimit("api-v1", String(apiKey._id), PER_MINUTE, 60_000);
  if (!limit.allowed) {
    return { error: NextResponse.json({ error: "Trop de requêtes pour cette clé. Réessayez plus tard." }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }) };
  }

  // Incrémenter le compteur de requêtes
  await ApiKeyModel.updateOne({ _id: apiKey._id }, { $inc: { requestCount: 1 }, $set: { lastUsedAt: new Date() } });

  return { context: {
    tenantId: String(apiKey.tenantId), scopes: apiKey.scopes ?? [], keyId: String(apiKey._id),
    ...(apiKey.userId ? { userId: String(apiKey.userId) } : {}),
    ...(apiKey.deskId ? { deskId: String(apiKey.deskId) } : {}),
  } };
}

/** Réponse 403 si la clé n'a pas le scope demandé, sinon null. */
export function missingScope(ctx: ApiV1Context, scope: string): NextResponse | null {
  if (ctx.scopes.includes(scope) || ctx.scopes.includes("*")) return null;
  return NextResponse.json({ error: `Scope insuffisant. Requis: ${scope}` }, { status: 403 });
}

/**
 * Clé d'un comptoir (EasyPay) avec le scope demandé : le contexte et son
 * comptoir, ou la réponse d'erreur.
 */
export async function spotContext(req: NextRequest, scope: "spot:read" | "spot:write"): Promise<{ ctx: ApiV1Context & { deskId: string } } | { error: NextResponse }> {
  const auth = await validateApiKey(req);
  if ("error" in auth) return auth;
  const denied = missingScope(auth.context, scope);
  if (denied) return { error: denied };
  if (!auth.context.deskId) return { error: NextResponse.json({ error: "Cette clé n'est liée à aucun comptoir : créez-la depuis le comptoir (onglet EasyPay)." }, { status: 403 }) };
  return { ctx: { ...auth.context, deskId: auth.context.deskId } };
}
