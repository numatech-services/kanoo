/**
 * Protection CSRF — double soumission de cookie.
 *
 * Le serveur pose `csrf_token` en cookie lisible par le script (httpOnly:false)
 * et exige que toute mutation renvoie la même valeur dans l'en-tête
 * `x-csrf-token`. Un site tiers peut déclencher une requête avec les cookies de
 * la victime, mais ne peut pas lire ce cookie : il ne peut donc pas produire
 * l'en-tête.
 *
 * Cela vient en complément de `sameSite: "lax"` sur `auth_token`, pas à sa
 * place — deux mécanismes indépendants, dont l'un survit à un changement de
 * politique de cookies des navigateurs.
 */

import { NextRequest } from "next/server";
import crypto from "crypto";

export const CSRF_COOKIE = "csrf_token";
export const CSRF_HEADER = "x-csrf-token";

/** Méthodes sans effet de bord : jamais soumises à la vérification. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Comparaison à temps constant. Les longueurs différentes sont rejetées avant
 * `timingSafeEqual`, qui exige des tampons de même taille.
 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export type CsrfVerdict = "ok" | "missing_cookie" | "missing_header" | "mismatch";

/**
 * Vérifie le jeton d'une requête mutante.
 * Les requêtes portant un jeton d'API (`Authorization: Bearer`) sont exemptées :
 * elles n'utilisent pas les cookies, donc ne sont pas exposées au CSRF.
 */
export function verifyCsrf(req: NextRequest): CsrfVerdict {
  if (SAFE_METHODS.has(req.method)) return "ok";

  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) return "ok";

  const cookie = req.cookies.get(CSRF_COOKIE)?.value;
  if (!cookie) return "missing_cookie";

  const header = req.headers.get(CSRF_HEADER);
  if (!header) return "missing_header";

  return safeEqual(cookie, header) ? "ok" : "mismatch";
}

export const CSRF_MESSAGES: Record<Exclude<CsrfVerdict, "ok">, string> = {
  missing_cookie: "Session de sécurité absente. Rechargez la page et réessayez.",
  missing_header: "Jeton de sécurité manquant sur la requête.",
  mismatch: "Jeton de sécurité invalide. Rechargez la page et réessayez.",
};
