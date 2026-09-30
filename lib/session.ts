import { NextRequest, NextResponse } from "next/server";
import { signToken, generateCsrfToken, TokenPayload } from "./auth";
import { CSRF_COOKIE } from "./csrf";

/**
 * Session GLISSANTE : le cookie ne vit qu'une fenêtre d'inactivité
 * (SESSION_IDLE_MINUTES, 5 min par défaut), prolongée à chaque battement
 * d'activité (/api/auth/ping). Sans activité, le navigateur le laisse expirer
 * et la requête suivante n'est plus authentifiée — la déconnexion est alors
 * imposée côté serveur, indépendamment du minuteur côté client.
 *
 * Le jeton (JWT) garde son expiration propre (JWT_EXPIRES_IN, 8 h) comme borne
 * dure : le battement ne réémet pas le jeton, il ne fait que repousser
 * l'échéance du cookie.
 */
const SESSION_IDLE_MINUTES = Number(process.env.SESSION_IDLE_MINUTES || "5");
const SESSION_MAX_AGE_S = Math.max(60, SESSION_IDLE_MINUTES * 60);

/**
 * Construit la charge utile d'une session à partir de l'utilisateur et de son
 * organisation.
 *
 * Point unique : la connexion classique et la vérification 2FA passaient par
 * deux constructions parallèles, et `sessionVersion` n'avait été ajouté que
 * dans l'une — ce qui neutralisait silencieusement la révocation de session.
 */
/** Map Mongoose ou objet simple → { role: niveau } (valeurs non reconnues ignorées). */
export function toLevels(v: unknown): TokenPayload["roleLevels"] {
  if (!v) return undefined;
  const entries = v instanceof Map ? [...v.entries()] : Object.entries(v as Record<string, unknown>);
  const out: NonNullable<TokenPayload["roleLevels"]> = {};
  for (const [k, lvl] of entries) if (lvl === "chef" || lvl === "employe" || lvl === "stagiaire") out[k] = lvl;
  return Object.keys(out).length ? out : undefined;
}

export function buildSessionPayload(
  user: {
    _id: { toString(): string };
    tenantId: { toString(): string };
    role: string;
    roles?: string[];
    email: string;
    allowedResources?: string[];
    roleLevels?: Record<string, string> | Map<string, string>;
    siteIds?: Array<{ toString(): string }>;
    sessionVersion?: number;
  },
  tenant: { type: string; subscriptionStatus: string; planModules: string[] }
): Omit<TokenPayload, "iat" | "exp"> {
  return {
    userId: user._id.toString(),
    tenantId: user.tenantId.toString(),
    tenantType: tenant.type as TokenPayload["tenantType"],
    role: user.role as TokenPayload["role"],
    // Rôles cumulés dans le jeton ; retombe sur [role] pour un compte mono-rôle.
    roles: (user.roles && user.roles.length > 0 ? user.roles : [user.role]) as TokenPayload["roles"],
    email: user.email,
    subscriptionStatus: tenant.subscriptionStatus as TokenPayload["subscriptionStatus"],
    planModules: tenant.planModules,
    allowedResources: user.allowedResources,
    roleLevels: toLevels(user.roleLevels),
    siteIds: (user.siteIds ?? []).map(String),
    sessionVersion: user.sessionVersion ?? 1,
  };
}

/**
 * Pose les cookies de session (auth_token + csrf_token) sur une réponse.
 *
 * `auth_token` est httpOnly : le script n'y touche jamais. `csrf_token` est
 * volontairement lisible — c'est le principe de la double soumission, le client
 * doit pouvoir le recopier dans l'en-tête `x-csrf-token`.
 */
export function setSessionCookies(
  response: NextResponse,
  tokenPayload: Omit<TokenPayload, "iat" | "exp">
): void {
  const token = signToken(tokenPayload);
  const csrfToken = generateCsrfToken();
  const isProd = process.env.NODE_ENV === "production";

  response.cookies.set("auth_token", token, {
    httpOnly: true, secure: isProd, sameSite: "lax", maxAge: SESSION_MAX_AGE_S, path: "/",
  });
  response.cookies.set(CSRF_COOKIE, csrfToken, {
    httpOnly: false, secure: isProd, sameSite: "lax", maxAge: SESSION_MAX_AGE_S, path: "/",
  });
}

/**
 * Prolonge la session glissante : réémet auth_token et csrf_token avec la MÊME
 * valeur mais une échéance de cookie rafraîchie. On ne re-signe pas le jeton
 * (l'expiration dure de 8 h reste celle de la connexion) et on ne change pas le
 * jeton CSRF (les requêtes en vol continuent de fonctionner). Renvoie `false`
 * s'il n'y a pas de session à prolonger.
 */
export function refreshSessionCookies(req: NextRequest, response: NextResponse): boolean {
  const token = req.cookies.get("auth_token")?.value;
  if (!token) return false;
  const csrf = req.cookies.get(CSRF_COOKIE)?.value;
  const isProd = process.env.NODE_ENV === "production";

  response.cookies.set("auth_token", token, {
    httpOnly: true, secure: isProd, sameSite: "lax", maxAge: SESSION_MAX_AGE_S, path: "/",
  });
  if (csrf) {
    response.cookies.set(CSRF_COOKIE, csrf, {
      httpOnly: false, secure: isProd, sameSite: "lax", maxAge: SESSION_MAX_AGE_S, path: "/",
    });
  }
  return true;
}

/** Efface les cookies de session. */
export function clearSessionCookies(response: NextResponse): void {
  for (const name of ["auth_token", CSRF_COOKIE, "twofa_token", "portail_token"]) {
    response.cookies.set(name, "", { httpOnly: true, path: "/", maxAge: 0 });
  }
}
