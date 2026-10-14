import crypto from "crypto";
import { ClientModel } from "@/models/Client";
import { encryptField, decryptField } from "@/lib/crypto-field";
import { appBaseUrl } from "@/lib/app-url";

/**
 * Portail client — un lien personnel par client, sans compte ni mot de passe,
 * envoyé par WhatsApp ou e-mail : le client y consulte ses factures, ses devis
 * et ses avoirs, télécharge les PDF, accepte un devis et paie en ligne.
 *
 * Le jeton (32 octets aléatoires) est un secret porteur : quiconque a le lien
 * voit les documents de ce client, et seulement les siens. Il est stocké deux
 * fois, jamais en clair : son empreinte SHA-256 pour le retrouver, et une copie
 * chiffrée (AES-GCM) pour réafficher le lien et l'imprimer en QR sur les PDF.
 * Régénérer le lien révoque l'ancien.
 */

const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
const TOKEN_RE = /^[A-Za-z0-9_-]{40,64}$/;

export function portalUrl(token: string) {
  return `${appBaseUrl()}/client/${token}`;
}

export async function createPortalLink(tenantId: string, clientId: unknown) {
  const token = crypto.randomBytes(32).toString("base64url");
  const r = await ClientModel.updateOne({ _id: clientId, tenantId },
    { $set: { portalTokenHash: hash(token), portalTokenEnc: encryptField(token), portalLinkAt: new Date() } });
  if (!r.matchedCount) return null;
  return { token, url: portalUrl(token) };
}

export async function revokePortalLink(tenantId: string, clientId: unknown) {
  await ClientModel.updateOne({ _id: clientId, tenantId }, { $unset: { portalTokenHash: 1, portalTokenEnc: 1, portalLinkAt: 1 } });
}

/** Lien actif d'un client (pour l'afficher, le partager ou l'imprimer), ou null. */
export async function currentPortalLink(tenantId: string, clientId: unknown): Promise<string | null> {
  const c = await ClientModel.findOne({ _id: clientId, tenantId }).select("+portalTokenEnc").lean<{ portalTokenEnc?: string } | null>();
  if (!c?.portalTokenEnc) return null;
  try { return portalUrl(decryptField(c.portalTokenEnc)); } catch { return null; }
}

/** Client désigné par un jeton, ou null (jeton mal formé, inconnu ou révoqué). */
export async function clientByToken(token: string) {
  if (!TOKEN_RE.test(token)) return null;
  return ClientModel.findOne({ portalTokenHash: hash(token) })
    .select("_id tenantId name email phone code").lean<{ _id: unknown; tenantId: unknown; name: string; email?: string; phone?: string; code?: string } | null>();
}
