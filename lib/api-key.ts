/**
 * Gestion des clés API publiques — Kanoo API v1
 * Les clés sont préfixées "kno_" et stockées hashées en base
 */
import crypto from "crypto";

export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const raw = crypto.randomBytes(32).toString("hex");
  const key = `kno_${raw}`;
  const hash = crypto.createHash("sha256").update(key).digest("hex");
  const prefix = `kno_${raw.slice(0, 8)}...`;
  return { key, hash, prefix };
}

export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export function getApiKeyFromRequest(req: Request): string | null {
  // Bearer kno_xxx ou X-API-Key: kno_xxx
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer kno_")) return auth.slice(7);
  const header = req.headers.get("x-api-key");
  if (header?.startsWith("kno_")) return header;
  return null;
}
