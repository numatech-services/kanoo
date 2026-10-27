import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookies } from "@/lib/session";
import { getTokenFromRequest, verifyToken } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { RevokedTokenModel } from "@/models/RevokedToken";

/**
 * Déconnexion : efface les cookies (web) et révoque le jeton présenté, qu'il
 * vienne du cookie ou de l'en-tête Bearer (application mobile). Sans
 * révocation, le jeton restait valable jusqu'à son expiration.
 */
export async function POST(req: NextRequest) {
  const token = getTokenFromRequest(req);
  if (token) {
    try {
      const { jti, exp } = verifyToken(token);
      if (jti && exp) {
        await connectDB();
        await RevokedTokenModel.updateOne({ _id: jti }, { $setOnInsert: { expireAt: new Date(exp * 1000) } }, { upsert: true });
      }
    } catch {
      // Jeton déjà expiré ou invalide : rien à révoquer.
    }
  }
  const response = NextResponse.json({ success: true, message: "Déconnexion réussie" });
  clearSessionCookies(response);
  return response;
}
