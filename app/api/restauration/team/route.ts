import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { deskScope } from "@/lib/comptoir";
import { authCan } from "@/lib/role-resources";
import { isMonth } from "@/lib/restaurant";
import { restaurantTeam } from "@/lib/restaurant-overview";

export const dynamic = "force-dynamic";

/**
 * GET /api/restauration/team?month= — personnel affecté à chaque restaurant
 * (part de son temps) et collaborateurs non affectés ; coût employeur du mois
 * et état de la paie pour qui gère la paie seulement. Droit : collaborateurs.
 */
export const GET = withAuth("employees", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const d = new Date(), month = new URL(req.url).searchParams.get("month") || `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  if (!isMonth(month)) return badRequest("Mois invalide (AAAA-MM).");
  return ok(await restaurantTeam(auth.tenantId, deskScope(auth), month, authCan(auth, "payslips", "read")));
});
