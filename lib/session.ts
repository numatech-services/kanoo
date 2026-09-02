import { NextResponse } from "next/server";
import { signToken, generateCsrfToken, TokenPayload } from "./auth";

/**
 * Pose les cookies de session (auth_token + csrf_token) sur une réponse.
 * Utilisé par la connexion classique et par la vérification 2FA, pour une
 * émission de session identique et unique.
 */
export function setSessionCookies(response: NextResponse, tokenPayload: Omit<TokenPayload, "iat" | "exp">): void {
  const token = signToken(tokenPayload);
  const csrfToken = generateCsrfToken();
  const isProd = process.env.NODE_ENV === "production";
  response.cookies.set("auth_token", token, { httpOnly: true, secure: isProd, sameSite: "lax", maxAge: 60 * 60 * 8, path: "/" });
  response.cookies.set("csrf_token", csrfToken, { httpOnly: false, secure: isProd, sameSite: "lax", maxAge: 60 * 60 * 8, path: "/" });
}
