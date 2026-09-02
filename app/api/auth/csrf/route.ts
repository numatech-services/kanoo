import { NextRequest, NextResponse } from "next/server";
import { generateCsrfToken } from "@/lib/auth";
import { CSRF_COOKIE } from "@/lib/csrf";

/**
 * GET /api/auth/csrf — retourne le jeton CSRF de la session.
 *
 * Le jeton existant est réutilisé s'il est présent : émettre une valeur neuve à
 * chaque appel ferait échouer toute mutation déjà partie avec l'ancienne, les
 * pages appelant cette route en parallèle de leurs propres requêtes.
 */
export async function GET(req: NextRequest) {
  const existing = req.cookies.get(CSRF_COOKIE)?.value;
  const csrfToken = existing || generateCsrfToken();

  const response = NextResponse.json({ csrfToken });

  // Le cookie est relu par le client (double soumission) : httpOnly reste faux.
  // Il ne porte aucun secret de session — seulement une valeur d'appariement.
  response.cookies.set(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 8,
    path: "/",
  });
  return response;
}
