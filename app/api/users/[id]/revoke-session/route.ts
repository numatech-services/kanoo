import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, forbidden, tenantFilter } from "@/lib/api-helpers";
import { UserModel } from "@/models/User";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

/**
 * POST /api/users/:id/revoke-session
 * Révoque toutes les sessions actives d'un utilisateur
 * Seul un admin peut révoquer les sessions des utilisateurs de son tenant
 */
export const POST = withAuth("users", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();

  // Vérifier que l'utilisateur cible appartient au même tenant
  const target = await UserModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!target) return notFound("Utilisateur introuvable");

  // Un utilisateur ne peut pas révoquer sa propre session via cet endpoint
  if (params.id === auth.userId) return forbidden("Utilisez /api/auth/logout pour vous déconnecter");

  // Incrémenter sessionVersion → invalide tous les tokens existants
  await UserModel.findByIdAndUpdate(params.id, {
    $inc: { sessionVersion: 1 },
    revokedAt: new Date(),
  });

  await logAudit(auth, "UPDATE", "users", {
    resourceId: params.id,
    after: {
      action: "session_revoked",
      targetUser: `${target.firstName} ${target.lastName}`,
      revokedBy: auth.email,
    },
  });

  return ok({
    message: `Sessions révoquées pour ${target.firstName} ${target.lastName}. L'utilisateur devra se reconnecter.`,
    revokedAt: new Date().toISOString(),
  });
});
