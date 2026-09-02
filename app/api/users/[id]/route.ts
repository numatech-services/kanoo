import { NextRequest } from "next/server";
import { withAuth, ok, notFound, forbidden, tenantFilter } from "@/lib/api-helpers";
import { UserModel } from "@/models/User";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("users", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const filter = auth.role === "superadmin" ? { _id: params.id } : { _id: params.id, ...tenantFilter(auth) };
  const user = await UserModel.findOne(filter).select("-passwordHash").lean();
  if (!user) return notFound(); return ok(user);
});
// Champs modifiables par l'utilisateur sur son propre profil.
const SELF_EDITABLE = ["firstName", "lastName", "phone", "avatar"] as const;
// Champs réservés aux administrateurs (sur les comptes de leur organisation).
const ADMIN_EDITABLE = ["role", "allowedResources", "isActive"] as const;
const TENANT_ADMIN_ROLES = ["pme_admin", "asso_president", "admin_ordonnateur", "superadmin"];

export const PATCH = withAuth("users", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  const isSelf = auth.userId === params.id;
  const isAdmin = TENANT_ADMIN_ROLES.includes(auth.role);
  if (!isSelf && !isAdmin) {
    return forbidden("Vous ne pouvez modifier que votre propre profil");
  }

  const body = await req.json();

  // Liste blanche stricte : jamais tenantId / passwordHash / sessionVersion /
  // email / _id depuis le corps (sinon élévation de privilèges ou cross-tenant).
  const update: Record<string, unknown> = {};
  for (const k of SELF_EDITABLE) if (k in body) update[k] = body[k];
  if (isAdmin) {
    for (const k of ADMIN_EDITABLE) if (k in body) update[k] = body[k];
    // Seul un superadmin peut octroyer le rôle superadmin.
    if (update.role === "superadmin" && auth.role !== "superadmin") {
      return forbidden("Attribution du rôle superadmin non autorisée");
    }
  }

  const user = await UserModel.findOneAndUpdate(
    { _id: params.id, ...tenantFilter(auth) },
    { $set: update },
    { new: true }
  ).select("-passwordHash");
  if (!user) return notFound();
  await logAudit(auth, "UPDATE", "users", { resourceId: params.id });
  return ok(user);
});
