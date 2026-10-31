import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { isId } from "@/lib/comptoir";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { isMonth } from "@/lib/restaurant";
import { restaurantTeam } from "@/lib/restaurant-overview";
import { validateStaff } from "@/lib/restaurant-team";
import { ActivityDeskModel } from "@/models/ActivityDesk";

export const dynamic = "force-dynamic";

const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

/**
 * GET /api/restauration/team?month= — personnel affecté à chaque restaurant
 * (part de son temps), état du bulletin du mois et coût employeur imputé ;
 * collaborateurs non affectés. Pour qui gère la paie, sur tous les restaurants.
 */
export const GET = withAuth("payslips", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const month = new URL(req.url).searchParams.get("month") || thisMonth();
  if (!isMonth(month)) return badRequest("Mois invalide (AAAA-MM).");
  return ok(await restaurantTeam(auth.tenantId, null, month, true));
});

/**
 * PATCH { deskId, staff: [{ employeeId, share }] } — équipe d'un restaurant,
 * par qui gère la paie (sans droit de paramétrer le comptoir lui-même).
 */
export const PATCH = withAuth("payslips", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  if (!isId(body.deskId) || !(await ActivityDeskModel.exists({ _id: body.deskId, tenantId: auth.tenantId }))) return notFound("Restaurant introuvable");
  try {
    const staff = await validateStaff(auth.tenantId, body.deskId, body.staff);
    await ActivityDeskModel.updateOne({ _id: body.deskId, tenantId: auth.tenantId }, { $set: { staff } });
    await logAudit(auth, "UPDATE", "comptoir", { resourceId: body.deskId, after: { staff: staff.map(s => `${s.employeeId}:${s.share}`) } });
    return ok({ staff });
  } catch (e) { if (e instanceof BusinessRuleError) return badRequest(e.message); throw e; }
});
