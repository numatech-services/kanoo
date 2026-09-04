import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { refreshSessionCookies } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/ping — battement d'activité de la session glissante.
 *
 * Appelé par le client sur une interaction réelle de l'utilisateur (souris,
 * clavier, défilement), au plus une fois par minute. Prolonge l'échéance des
 * cookies de session tant que la personne est active ; sans battement, le
 * cookie expire de lui-même après la fenêtre d'inactivité et la déconnexion
 * est imposée côté serveur.
 *
 * Ne réémet pas le jeton : si le JWT a dépassé sa borne dure (8 h),
 * getAuthContext renvoie null et on répond 401 sans prolonger.
 */
export async function POST(req: NextRequest) {
  const auth = getAuthContext(req);
  if (!auth) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const res = NextResponse.json({ success: true });
  refreshSessionCookies(req, res);
  return res;
}
