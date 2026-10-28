import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { withAuth, ok, created, badRequest, forbidden, notFound, tenantFilter } from "@/lib/api-helpers";
import { isId, ownDesk, canSeeDeskCosts } from "@/lib/comptoir";
import { hasFinanceAccess } from "@/lib/role-resources";
import { generateApiKey } from "@/lib/api-key";
import { ApiKeyModel } from "@/models/ApiKey";
import { IntegrationEventModel } from "@/models/IntegrationEvent";
import { easypayBalance, recordRemittance, SOURCE } from "@/lib/easypay-server";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Durée de vie d'une clé EasyPay (renouvelée depuis cet écran). */
const KEY_DAYS = 730;

/**
 * GET ?deskId&status — liaison EasyPay du comptoir : clés (sans leur valeur),
 * événements reçus (100 derniers, filtrables), compteurs par état, solde du
 * compte courant Numatech. Réservé au chef du comptoir et à la finance.
 */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  if (!canSeeDeskCosts(auth)) return forbidden("Réservé au chef du comptoir et à la finance.");
  const url = new URL(req.url);
  const deskId = url.searchParams.get("deskId");
  if (!isId(deskId) || !(await ownDesk(auth, deskId))) return notFound("Comptoir introuvable");
  const status = url.searchParams.get("status");
  const base = { ...tenantFilter(auth), deskId: new Types.ObjectId(deskId), source: SOURCE };
  const [keys, events, counts, balance] = await Promise.all([
    ApiKeyModel.find({ ...tenantFilter(auth), deskId, source: SOURCE }).select("-keyHash").sort({ createdAt: -1 }).lean(),
    IntegrationEventModel.find({ ...base, ...(status && ["applied", "failed", "rejected", "ignored"].includes(status) ? { status } : {}) })
      .select("-payload").sort({ createdAt: -1 }).limit(100).lean(),
    IntegrationEventModel.aggregate<{ _id: string; n: number }>([{ $match: base }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
    hasFinanceAccess(auth) ? easypayBalance(auth.tenantId) : Promise.resolve(null),
  ]);
  return ok({ keys, events, counts: Object.fromEntries(counts.map(c => [c._id, c.n])), balance });
});

/**
 * POST { deskId, action } :
 *  - create_key { name? } : clé de l'API pour EasyPay (montrée une seule fois) ;
 *  - revoke_key { keyId } ;
 *  - remittance { treasuryAccountId, amount, direction: received|paid, date?, reference? } (finance).
 */
export const POST = withAuth("comptoir", "update", async (req: NextRequest, auth: TokenPayload) => {
  if (!canSeeDeskCosts(auth)) return forbidden("Réservé au chef du comptoir et à la finance.");
  const body = await req.json().catch(() => ({}));
  if (!isId(body.deskId) || !(await ownDesk(auth, body.deskId))) return notFound("Comptoir introuvable");

  if (body.action === "create_key") {
    const { key, hash, prefix } = generateApiKey();
    const doc = await ApiKeyModel.create({
      tenantId: auth.tenantId, userId: auth.userId, name: String(body.name || "EasyPay").slice(0, 80),
      keyHash: hash, keyPrefix: prefix, scopes: ["spot:read", "spot:write"], deskId: body.deskId, source: SOURCE,
      expiresAt: new Date(Date.now() + KEY_DAYS * 86_400_000),
    });
    await logAudit(auth, "CREATE", "api_key", { metadata: { keyId: String(doc._id), deskId: String(body.deskId), source: SOURCE } });
    return created({ key, prefix, expiresAt: doc.expiresAt, warning: "Cette clé ne sera plus affichée : copiez-la dans EasyPay maintenant." });
  }
  if (body.action === "revoke_key") {
    if (!isId(body.keyId)) return badRequest("Clé invalide.");
    const r = await ApiKeyModel.updateOne({ _id: body.keyId, ...tenantFilter(auth), deskId: body.deskId, source: SOURCE, isActive: true }, { $set: { isActive: false, revokedAt: new Date() } });
    if (r.modifiedCount !== 1) return notFound("Clé introuvable ou déjà révoquée.");
    await logAudit(auth, "UPDATE", "api_key", { metadata: { keyId: String(body.keyId), revoked: true } });
    return ok({ revoked: true });
  }
  if (body.action === "remittance") {
    if (!hasFinanceAccess(auth)) return forbidden("Les reversements sont réservés à la finance.");
    if (!isId(body.treasuryAccountId)) return badRequest("Choisissez le compte de trésorerie.");
    const entry = await recordRemittance(auth, { treasuryAccountId: body.treasuryAccountId, amount: Number(body.amount), direction: body.direction, date: body.date, reference: body.reference });
    await logAudit(auth, "CREATE", "easypay_remittance", { metadata: { entryId: String(entry._id), amount: Number(body.amount), direction: body.direction } });
    return created({ entryId: entry._id, balance: await easypayBalance(auth.tenantId) });
  }
  return badRequest("Action inconnue.");
});
