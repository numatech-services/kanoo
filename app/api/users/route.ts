import { NextRequest } from "next/server";
import { withAuth, created, badRequest, conflict, forbidden, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { UserModel } from "@/models/User";
import { hashPassword } from "@/lib/auth";
import { TenantModel } from "@/models/Tenant";
import { passwordErrors } from "@/lib/password-policy";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("users", "read", async (req: NextRequest, auth: TokenPayload) => {
  const pagination = getPagination(req);
  const filter: Record<string, unknown> = auth.role === "superadmin" ? {} : tenantFilter(auth);
  const [items, total] = await Promise.all([
    UserModel.find(filter).select("-passwordHash").sort({ lastName: 1 }).skip(pagination.skip).limit(pagination.limit).lean(),
    UserModel.countDocuments(filter),
  ]);
  return paginatedResponse(items, total, pagination);
});

export const POST = withAuth("users", "create", async (req: NextRequest, auth: TokenPayload) => {
  if (!["pme_admin", "asso_president", "admin_ordonnateur", "superadmin"].includes(auth.role)) {
    return forbidden("Seuls les administrateurs peuvent créer des utilisateurs");
  }
  const body = await req.json();
  const err = requireFields(body, ["email", "password", "firstName", "lastName", "role"]);
  if (err) return badRequest(err);

  // Rôles assignables selon le type d'organisation de l'appelant.
  const ASSIGNABLE: Record<string, string[]> = {
    pme: ["pme_admin", "pme_manager", "pme_accountant", "pme_sales", "pme_purchases", "pme_hr", "pme_project_manager", "pme_approver", "pme_viewer", "chef_projet_transversal", "tech_admin"],
    association: ["asso_president", "asso_treasurer", "asso_secretary", "asso_project_manager", "asso_member_portal", "chef_projet_transversal", "tech_admin"],
    administration: ["admin_ordonnateur", "admin_daf", "admin_public_accountant", "admin_procurement_officer", "admin_procurement_commission", "admin_viewer", "chef_projet_transversal", "tech_admin"],
  };
  const allowedRoles = auth.role === "superadmin"
    ? [...ASSIGNABLE.pme, ...ASSIGNABLE.association, ...ASSIGNABLE.administration, "superadmin"]
    : (ASSIGNABLE[auth.tenantType] ?? []);
  if (!allowedRoles.includes(body.role)) {
    return badRequest("Rôle non autorisé pour ce type d'organisation");
  }
  // Champs sensibles jamais acceptés depuis le corps.
  delete body._id;
  delete body.tenantId;
  delete body.sessionVersion;
  delete body.passwordHash;
  // allowedResources personnalisé réservé au superadmin.
  if (body.allowedResources && auth.role !== "superadmin") delete body.allowedResources;

  const existing = await UserModel.findOne({ email: body.email.toLowerCase(), tenantId: auth.tenantId });
  if (existing) return conflict("Un utilisateur avec cet email existe déjà");

  // La politique s'applique dès la création. Sans ce contrôle, elle ne
  // protégeait que ceux qui changeaient leur mot de passe — c'est-à-dire
  // personne, puisqu'aucune route ne le permettait.
  const tenant = await TenantModel.findById(auth.tenantId).select("name")
    .lean<{ name?: string } | null>();
  const problems = passwordErrors(String(body.password), {
    email: body.email, firstName: body.firstName, lastName: body.lastName,
    tenantName: tenant?.name,
  });
  if (problems.length > 0) return badRequest(problems.join(" "));

  const passwordHash = await hashPassword(body.password);
  const user = await UserModel.create({ ...body, email: body.email.toLowerCase(), passwordHash, tenantId: auth.tenantId });
  await logAudit(auth, "CREATE", "users", { resourceId: user._id.toString(), after: { email: user.email, role: user.role } });
  return created({ ...user.toObject(), passwordHash: undefined });
});
