import { NextRequest, NextResponse } from "next/server";
import { spotContext, type ApiV1Context } from "@/lib/api-v1-middleware";
import { decryptField } from "@/lib/crypto-field";
import { verifySignature, SPEC_VERSION } from "@/lib/easypay-v1";
import { ApiKeyModel } from "@/models/ApiKey";

/** Corps lu une seule fois, brut (la signature porte sur ces octets), 2 Mo au plus. */
export async function readRaw(req: NextRequest): Promise<{ raw: string; body: unknown } | { error: NextResponse }> {
  if (Number(req.headers.get("content-length") || 0) > 2_000_000) return { error: NextResponse.json({ error: "payload_too_large" }, { status: 413 }) };
  const raw = await req.text();
  if (raw.length > 2_000_000) return { error: NextResponse.json({ error: "payload_too_large" }, { status: 413 }) };
  try { return { raw, body: JSON.parse(raw) }; } catch { return { raw, body: null }; }
}

export const unauthorized = () => NextResponse.json({ error: "unauthorized" }, { status: 401 });
export const unknownSite = () => NextResponse.json({ error: "unknown_site" }, { status: 403 });
export const invalid = (message: string) => NextResponse.json({ error: "invalid_payload", message }, { status: 422 });

/**
 * Requête du contrat v1 hors poignée de main : jeton du comptoir, restaurant
 * relié par une poignée de main réussie et égal à X-EasyPay-Site, signature
 * HMAC du corps brut avec le secret de la liaison, horloge à ±300 s.
 */
export async function v1Context(req: NextRequest, raw: string): Promise<{ ctx: ApiV1Context & { deskId: string }; siteId: string } | { error: NextResponse }> {
  const a = await spotContext(req, "spot:write");
  if ("error" in a) return a;
  const version = req.headers.get("x-easypay-spec-version");
  if (version && version !== SPEC_VERSION) return { error: invalid(`spec_version ${SPEC_VERSION} attendue.`) };
  const key = await ApiKeyModel.findById(a.ctx.keyId).select("+signingSecret easypaySite").lean<{ signingSecret?: string; easypaySite?: string } | null>();
  // Pas de poignée de main réussie : aucun secret pour vérifier la signature.
  if (!key?.signingSecret || !key.easypaySite) return { error: unauthorized() };
  if (req.headers.get("x-easypay-site") !== key.easypaySite) return { error: unknownSite() };
  let secret = "";
  try { secret = decryptField(key.signingSecret); } catch { return { error: unauthorized() }; }
  if (!verifySignature(req.headers.get("x-easypay-signature"), raw, secret)) return { error: unauthorized() };
  return { ctx: a.ctx, siteId: key.easypaySite };
}
