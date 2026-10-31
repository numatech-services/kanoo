import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, forbidden } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { canSeeDeskCosts, deskScope } from "@/lib/comptoir";
import { isMonth } from "@/lib/restaurant";
import { restaurantOverview } from "@/lib/restaurant-overview";

export const dynamic = "force-dynamic";

/**
 * GET /api/restauration/overview?month=AAAA-MM — tous les restaurants visibles :
 * CA, marge, charges, résultat, marge nette face à la cible (20 % par défaut),
 * et les actions à mener. Chef du comptoir, direction et comptabilité.
 */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  if (!canSeeDeskCosts(auth)) return forbidden("Vue réservée au chef du comptoir, à la direction et à la comptabilité.");
  const d = new Date(), month = new URL(req.url).searchParams.get("month") || `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  if (!isMonth(month)) return badRequest("Mois invalide (AAAA-MM).");
  return ok(await restaurantOverview(auth.tenantId, deskScope(auth), month));
});
