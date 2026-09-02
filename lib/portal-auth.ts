/**
 * Authentification des portails externes (adhérents, fournisseurs).
 *
 * Ces portails s'adressent à des personnes qui n'ont pas de compte dans
 * l'application : elles se connectent avec leur email et un code d'accès. Le
 * modèle de menace n'est donc pas celui d'un salarié, et cette couche est
 * volontairement séparée de la session applicative :
 *
 *  - secret de signature dérivé, distinct de celui des sessions ;
 *  - revendication `purpose` explicite, pour qu'un jeton de portail ne puisse
 *    jamais être présenté comme une session ;
 *  - code d'accès tiré cryptographiquement et stocké haché.
 */

import jwt from "jsonwebtoken";
import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { hashPassword, comparePassword } from "./auth";

const PORTAL_TOKEN_TTL = "7d";
const PORTAL_COOKIE = "portail_token";

/**
 * Secret dédié. `PORTAL_JWT_SECRET` s'il est fourni, sinon une dérivation de
 * `JWT_SECRET` — jamais une chaîne littérale de repli : une valeur en dur dans
 * le dépôt permettrait de forger un jeton pour n'importe quelle organisation.
 */
function getPortalSecret(): string {
  const dedicated = process.env.PORTAL_JWT_SECRET;
  if (dedicated && dedicated.length >= 32) return dedicated;

  const base = process.env.JWT_SECRET;
  const usable = base && base.length >= 32 && !base.startsWith("CHANGE_ME");
  if (usable) return `${base}:portal`;

  if (process.env.NODE_ENV !== "production") {
    return "dev-only-insecure-secret-0000000000000000000000000000:portal";
  }
  throw new Error(
    "PORTAL_JWT_SECRET ou JWT_SECRET manquant : authentification portail refusée."
  );
}

export interface PortalIdentity {
  id: string;
  tenantId: string;
  type: "adherent" | "fournisseur";
  email: string;
}

export function signPortalToken(identity: PortalIdentity): string {
  return jwt.sign({ ...identity, purpose: "portal" }, getPortalSecret(), {
    expiresIn: PORTAL_TOKEN_TTL,
    algorithm: "HS256",
  });
}

/**
 * Vérifie un jeton de portail. Retourne `null` sur tout doute — signature,
 * expiration, ou revendication `purpose` absente.
 */
export function verifyPortalToken(req: NextRequest): PortalIdentity | null {
  const header = req.headers.get("authorization");
  const token = req.cookies.get(PORTAL_COOKIE)?.value
    || (header?.startsWith("Bearer ") ? header.slice(7) : null);
  if (!token) return null;

  try {
    const payload = jwt.verify(token, getPortalSecret(), { algorithms: ["HS256"] }) as
      Partial<PortalIdentity> & { purpose?: string };
    if (payload.purpose !== "portal") return null;
    if (!payload.id || !payload.tenantId || !payload.type || !payload.email) return null;
    return {
      id: payload.id, tenantId: payload.tenantId,
      type: payload.type, email: payload.email,
    };
  } catch {
    return null;
  }
}

export function setPortalCookie(response: NextResponse, token: string): void {
  response.cookies.set(PORTAL_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 86400,
    path: "/",
  });
}

export function clearPortalCookie(response: NextResponse): void {
  response.cookies.set(PORTAL_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

// ─── Codes d'accès ────────────────────────────────────────────────────────────

/**
 * Code à huit caractères, tiré de `crypto`. Huit chiffres plutôt que six :
 * l'espace passe de 10⁶ à 10⁸, ce qui rend le parcours exhaustif hors de portée
 * même si la limitation de débit venait à sauter.
 */
export function generateAccessCode(): string {
  return String(crypto.randomInt(10_000_000, 100_000_000));
}

/** Le code n'est jamais stocké en clair : une fuite de la base le rendrait rejouable. */
export function hashAccessCode(code: string): Promise<string> {
  return hashPassword(code);
}

/**
 * Vérifie un code contre son empreinte.
 *
 * Tolère les enregistrements antérieurs au hachage (`legacyPlain`) : la
 * migration se fait à la première connexion réussie, sans invalider les codes
 * déjà distribués aux adhérents.
 */
export async function verifyAccessCode(
  submitted: string,
  hash?: string,
  legacyPlain?: string
): Promise<{ valid: boolean; needsUpgrade: boolean }> {
  if (hash) {
    return { valid: await comparePassword(submitted, hash), needsUpgrade: false };
  }
  if (legacyPlain) {
    const a = Buffer.from(submitted);
    const b = Buffer.from(legacyPlain);
    const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
    return { valid, needsUpgrade: valid };
  }
  return { valid: false, needsUpgrade: false };
}
