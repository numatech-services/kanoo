import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, forbidden } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { canSeeDeskCosts, isId, ownDesk } from "@/lib/comptoir";
import { deskPricing } from "@/lib/restaurant-overview";

export const dynamic = "force-dynamic";

/**
 * GET /api/restauration/pricing?deskId= — prix d'achat (coût de revient,
 * recette comprise), prix de vente, marge brute, part des frais de
 * fonctionnement, marge nette et prix minimum pour la marge visée, article par
 * article. Le prix se change ensuite sur l'article (PATCH /api/comptoir/items/:id).
 */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  if (!canSeeDeskCosts(auth)) return forbidden("Prix de revient réservés au chef du comptoir, à la direction et à la comptabilité.");
  const deskId = new URL(req.url).searchParams.get("deskId");
  if (!isId(deskId) || !(await ownDesk(auth, deskId))) return notFound("Comptoir introuvable");
  return ok(await deskPricing(auth.tenantId, deskId));
});
