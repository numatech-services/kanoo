import { NextRequest, NextResponse } from "next/server";
import { spotContext } from "@/lib/api-v1-middleware";
import { encryptField } from "@/lib/crypto-field";
import { parseHandshake, verifySignature, challengeResponse, SPEC_VERSION } from "@/lib/easypay-v1";
import { readRaw, unauthorized, unknownSite, invalid } from "@/lib/easypay-v1-server";
import { logAudit } from "@/lib/audit";
import { easypayActor } from "@/lib/easypay-server";
import { ApiKeyModel } from "@/models/ApiKey";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/spot/handshake — poignée de main du contrat EasyPay v1 (§4).
 * Le jeton désigne le comptoir ; la requête est signée avec le NOUVEAU secret
 * qu'elle contient. Kanoo le garde chiffré (il remplace l'ancien) et prouve
 * qu'il l'a reçu : HMAC-SHA256 du challenge avec ce secret.
 */
export async function POST(req: NextRequest) {
  const read = await readRaw(req);
  if ("error" in read) return read.error;
  const a = await spotContext(req, "spot:write");
  if ("error" in a) return a.error;
  const hs = parseHandshake(read.body);
  if (!hs.ok) return invalid(hs.error);
  if (req.headers.get("x-easypay-site") !== hs.siteId) return unknownSite();
  const key = await ApiKeyModel.findById(a.ctx.keyId).select("easypaySite").lean<{ easypaySite?: string } | null>();
  // Un jeton relié à un restaurant ne sert pas à en relier un autre.
  if (key?.easypaySite && key.easypaySite !== hs.siteId) return unknownSite();
  if (!verifySignature(req.headers.get("x-easypay-signature"), read.raw, hs.secret)) return unauthorized();
  await ApiKeyModel.updateOne({ _id: a.ctx.keyId }, { $set: { signingSecret: encryptField(hs.secret), easypaySite: hs.siteId, easypaySiteName: hs.siteName, handshakeAt: new Date() } });
  // Journal d'audit sans le secret ni le jeton.
  await easypayActor(a.ctx).then(actor => logAudit(actor, "UPDATE", "apiKeys", { resourceId: a.ctx.keyId, after: { easypayHandshake: hs.siteId } })).catch(() => undefined);
  return NextResponse.json({ ok: true, spec_version: SPEC_VERSION, challenge_response: challengeResponse(hs.challenge, hs.secret) });
}
