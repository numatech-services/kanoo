import { NextRequest, NextResponse } from "next/server";
import { verifyTokenEdge } from "./lib/auth-edge"; // On importe la version compatible Edge
import { buildCsp, newNonce } from "./lib/csp";

// ─── Constantes de session ────────────────────────────────────────────────────
const PUBLIC_EXACT_PATHS = [
  "/", "/login", "/souscrire", "/activer-compte", "/contact",
  // Vitrine publique — accessible sans authentification.
  "/fonctionnalites", "/tarifs", "/demo", "/a-propos", "/confidentialite",
  // Récupération de compte : par construction, l'utilisateur n'a pas de session.
  "/mot-de-passe-oublie", "/reinitialiser",
];
// API publique (clé d'API), webhook de paiement (signature) et portails
// adhérent / fournisseur (jeton de portail) s'authentifient eux-mêmes : sans
// cookie de session, le filtre les rejetait tous.
const PUBLIC_PREFIX_PATHS = ["/_next", "/favicon.ico", "/api/auth", "/api/public", "/api/demo-requests", "/api/cron", "/api/health", "/api/client-errors", "/api/v1/", "/api/webhooks/", "/api/portail/", "/portail/", "/client/", "/reunion", "/manifest.json", "/icons/", "/icon.png", "/apple-icon.png", "/sw.js", "/offline", "/robots.txt", "/sitemap.xml"];

// ─── Sécurité ────────────────────────────────────────────────────────────────
const DEV = process.env.NODE_ENV !== "production";

function withSecurityHeaders(res: NextResponse, nonce?: string): NextResponse {
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Content-Security-Policy", buildCsp(nonce, { dev: DEV, frameAncestors: true }));
  return res;
}

/**
 * Laisse passer la requête en transmettant au rendu un nonce neuf : Next.js
 * le lit dans l'en-tête `content-security-policy` de la requête pour l'apposer
 * sur ses scripts, le layout racine dans `x-nonce`.
 */
function pass(req: NextRequest): NextResponse {
  const nonce = newNonce();
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", buildCsp(nonce, { dev: DEV }));
  return withSecurityHeaders(NextResponse.next({ request: { headers } }), nonce);
}

function isPublicPage(pathname: string): boolean {
  if (PUBLIC_EXACT_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIX_PATHS.some(p => pathname.startsWith(p));
}

// AJOUT DE 'async' : Indispensable pour utiliser jose (jwtVerify)
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1. Laisser passer les pages publiques
  if (isPublicPage(pathname)) {
    return pass(req);
  }

  // 2. Jeton de session : cookie (navigateur) ou, pour l'API seulement, en-tête
  // `Authorization: Bearer` (application mobile, qui n'a pas de cookies).
  // Les routes revérifient le jeton et la version de session (withAuth) ; un
  // Bearer est exempté du contrôle CSRF, qui ne concerne que les cookies.
  const bearer = pathname.startsWith("/api") ? req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/)?.[1] : undefined;
  const token = req.cookies.get("auth_token")?.value || bearer;

  if (!token) {
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  try {
    // 3. Vérification du token via jose (lib/auth-edge.ts)
    const auth = await verifyTokenEdge(token);

    if (!auth) {
      // Un jeton présent mais invalide (falsifié, expiré, mauvaise signature)
      // sur une route API doit répondre 401 JSON, pas rediriger vers /login :
      // un client fetch suivrait le 307 et recevrait du HTML au lieu d'un code
      // exploitable, cassant la détection « session expirée » de l'appelant.
      if (pathname.startsWith("/api")) {
        return withSecurityHeaders(NextResponse.json({ error: "Session invalide ou expirée" }, { status: 401 }));
      }
      return NextResponse.redirect(new URL("/login", req.url));
    }

    // 4. Logique de redirection selon les rôles
    if (auth.role === "superadmin") {
      return pass(req);
    }

    // Protection de l'espace superadmin (/saas)
    if (pathname.startsWith("/saas") && auth.role !== "superadmin") {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }

    return pass(req);

  } catch (err) {
    console.error("[Middleware] Erreur de vérification du jeton", err);
    // Même règle dans le filet : une API reçoit 401, pas une redirection HTML.
    if (pathname.startsWith("/api")) {
      return withSecurityHeaders(NextResponse.json({ error: "Session invalide" }, { status: 401 }));
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }
}

export const config = {
  // On exclut les assets pour ne pas ralentir le middleware
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};