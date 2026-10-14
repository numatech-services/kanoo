import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { clientByToken } from "@/lib/client-portal";
import { rateLimit, clientIp } from "@/lib/rate-limit";

/**
 * Garde commune des routes publiques du portail : limite de débit par adresse
 * (un jeton ne se devine pas, mais on ne laisse pas tester des milliers de
 * jetons), puis résolution du client. Réponse unique « lien invalide » quel que
 * soit le motif, pour ne rien révéler.
 */
export async function portalGate(req: NextRequest, token: string) {
  const limit = rateLimit("client-portal", clientIp(req), 60, 60_000);
  if (!limit.allowed) {
    return { ok: false as const, response: NextResponse.json({ success: false, error: `Trop de requêtes. Réessayez dans ${limit.retryAfter} secondes.` }, { status: 429 }) };
  }
  await connectDB();
  const client = await clientByToken(token);
  if (!client) return { ok: false as const, response: NextResponse.json({ success: false, error: "Ce lien n'est plus valide. Demandez un nouveau lien à votre fournisseur." }, { status: 404 }) };
  return { ok: true as const, client };
}

export const onlinePaymentsConfigured = () =>
  Boolean(process.env.PAYDUNYA_MASTER_KEY && process.env.PAYDUNYA_PRIVATE_KEY && process.env.PAYDUNYA_TOKEN);
