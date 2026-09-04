import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { UserModel } from "@/models/User";

export const dynamic = "force-dynamic";

/**
 * GET /api/agenda/directory — annuaire léger des collaborateurs de
 * l'organisation, pour convier des participants à un événement. Guardé par la
 * ressource « agenda » (universelle) : chacun peut inviter, quel que soit son
 * accès aux autres modules. Ne renvoie que id + nom.
 */
export const GET = withAuth("agenda", "read", async (_req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const users = await UserModel.find({ ...tenantFilter(auth), isActive: true })
    .select("firstName lastName")
    .sort({ lastName: 1, firstName: 1 })
    .limit(1000)
    .lean();
  return ok(users);
});
