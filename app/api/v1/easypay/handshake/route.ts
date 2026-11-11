import { NextRequest, NextResponse } from "next/server";
import { encryptField } from "@/lib/crypto-field";
import { parseHandshake, verifySignature, challengeResponse, SPEC_VERSION } from "@/lib/easypay-v1";
import { readRaw, unauthorized, unknownSite, invalid } from "@/lib/easypay-v1-server";
import { networkKey } from "@/lib/easypay-network-server";
import { NETWORK_SITE } from "@/lib/easypay-network";
import { ApiKeyModel } from "@/models/ApiKey";
import { logAudit } from "@/lib/audit";
import { easypayActor } from "@/lib/easypay-server";

export const dynamic = "force-dynamic";

/** POST /api/v1/easypay/handshake — poignée de main de la liaison réseau (`_easypay`), contrat 1.1. */
export async function POST(req: NextRequest) {
  const read = await readRaw(req);
  if ("error" in read) return read.error;
  const a = await networkKey(req);
  if ("error" in a) return a.error;
  const hs = parseHandshake(read.body);
  if (!hs.ok) return invalid(hs.error);
  if (hs.siteId !== NETWORK_SITE || req.headers.get("x-easypay-site") !== NETWORK_SITE) return unknownSite();
  if (!verifySignature(req.headers.get("x-easypay-signature"), read.raw, hs.secret)) return unauthorized();
  await ApiKeyModel.updateOne({ _id: a.ctx.keyId }, { $set: { signingSecret: encryptField(hs.secret), easypaySite: hs.siteId, easypaySiteName: hs.siteName, handshakeAt: new Date() } });
  await easypayActor({ tenantId: a.ctx.tenantId, userId: a.ctx.userId! }).then(actor => logAudit(actor, "UPDATE", "apiKeys", { resourceId: a.ctx.keyId, after: { easypayHandshake: hs.siteId } })).catch(() => undefined);
  return NextResponse.json({ ok: true, spec_version: SPEC_VERSION, challenge_response: challengeResponse(hs.challenge, hs.secret) });
}
