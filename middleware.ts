import { NextRequest, NextResponse } from "next/server";
import { verifyTokenEdge } from "./lib/auth-edge"; // On importe la version compatible Edge

// ─── Constantes de session ────────────────────────────────────────────────────
const PUBLIC_EXACT_PATHS = [
  "/", "/login", "/souscrire", "/activer-compte", "/contact",
  // Vitrine publique — accessible sans authentification.
  "/fonctionnalites", "/tarifs", "/demo", "/a-propos", "/confidentialite",
];
const PUBLIC_PREFIX_PATHS = ["/_next", "/favicon.ico", "/api/auth", "/api/public", "/manifest.json", "/sw.js", "/offline"];

// ─── Sécurité ────────────────────────────────────────────────────────────────
function withSecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  return res;
}

function isPublicPage(pathname: string): boolean {
  if (PUBLIC_EXACT_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIX_PATHS.some(p => pathname.startsWith(p));
}

// AJOUT DE 'async' : Indispensable pour utiliser jose (jwtVerify)
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1. Laisser passer les pages publiques
  if (isPublicPage(pathname)) {
    return withSecurityHeaders(NextResponse.next());
  }

  // 2. Récupérer le token depuis les cookies (plus fiable dans le middleware)
  const token = req.cookies.get("auth_token")?.value;

  if (!token) {
    console.log("⚠️ [Middleware] AUCUN TOKEN détecté pour : - middleware.ts:35", pathname);
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  try {
    // 3. Vérification du token via jose (lib/auth-edge.ts)
    const auth = await verifyTokenEdge(token);

    if (!auth) {
      console.log("❌ [Middleware] Token invalide ou expiré - middleware.ts:47");
      return NextResponse.redirect(new URL("/login", req.url));
    }

    console.log(`✅ [Middleware] Accès accordé : ${auth.role} > ${pathname} - middleware.ts:51`);

    // 4. Logique de redirection selon les rôles
    if (auth.role === "superadmin") {
      return withSecurityHeaders(NextResponse.next());
    }

    // Protection de l'espace superadmin (/saas)
    if (pathname.startsWith("/saas") && auth.role !== "superadmin") {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }

    return withSecurityHeaders(NextResponse.next());

  } catch (err) {
    console.log("❌ [Middleware] Erreur critique : - middleware.ts:66", err);
    return NextResponse.redirect(new URL("/login", req.url));
  }
}

export const config = {
  // On exclut les assets pour ne pas ralentir le middleware
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};