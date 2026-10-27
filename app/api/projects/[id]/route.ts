import { NextRequest } from "next/server";
import { projectScope } from "@/lib/project-scope";
import { Types } from "mongoose";
import { withAuth, ok, notFound, noContent, badRequest, tenantFilter, sanitizeBody } from "@/lib/api-helpers";
import { ProjectModel } from "@/models/Project";
// Modèles référencés par le populate : sans cet import, ils ne sont pas
// enregistrés dans ce bundle de route et la fiche projet répondait 500
// (MissingSchemaError: Member).
import "@/models/Member";
import "@/models/BureauMember";
import "@/models/User";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { maskProjectMoney, stripProjectMoneyWrites } from "@/lib/payroll-mask";
import { projectFinance } from "@/lib/project-finance";
import { hasFinanceAccess } from "@/lib/role-resources";
import { checkProjectRefs } from "@/lib/project-refs";

const MEMBERS = "projectMembers.userId projectMembers.memberId projectMembers.bureauMemberId";

export const GET = withAuth("projects", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!Types.ObjectId.isValid(params.id)) return notFound();

  const item = await ProjectModel.findOne({ _id: params.id, ...tenantFilter(auth), ...projectScope(auth) })
    .populate(MEMBERS, "firstName lastName")
    .lean<Record<string, unknown> | null>();
  if (!item) return notFound();

  // Budget et montants : gérant et comptabilité seulement. Coût et recettes
  // réels viennent des écritures imputées au projet.
  if (!hasFinanceAccess(auth)) return ok(maskProjectMoney(item, auth));
  const fin = (await projectFinance(auth.tenantId, [item._id])).get(String(item._id)) ?? { cost: 0, revenue: 0, margin: 0 };
  return ok({ ...item, finance: fin });
});

export const PATCH = withAuth("projects", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!Types.ObjectId.isValid(params.id)) return notFound();

  // Jamais le corps brut : ni tenantId, ni opérateur Mongo, ni montant fixé
  // par un compte sans accès aux finances ; taux recalculés par le modèle.
  const body = stripProjectMoneyWrites(sanitizeBody(await req.json(), ["conversationId", "executionRate", "budgetRate"]), auth);
  // Identifiants provisoires de l'écran (« temp-… ») : Mongo en attribue de vrais.
  for (const k of ["tasks", "milestones", "projectMembers", "documents"]) {
    if (Array.isArray(body[k])) {
      body[k] = (body[k] as Array<Record<string, unknown>>).map(({ _id, ...rest }) =>
        _id && Types.ObjectId.isValid(String(_id)) ? { _id, ...rest } : rest);
    }
  }
  for (const k of ["clientId", "managerId"]) if (body[k] === "") body[k] = null;
  const refErr = await checkProjectRefs(auth.tenantId, body);
  if (refErr) return badRequest(refErr);

  const item = await ProjectModel.findOne({ _id: params.id, ...tenantFilter(auth), ...projectScope(auth) });
  if (!item) return notFound();
  // Sans accès aux finances : les montants des jalons existants sont conservés.
  if (!hasFinanceAccess(auth) && Array.isArray(body.milestones)) {
    const prev = new Map(((item.milestones ?? []) as Array<{ _id: unknown; amount?: number; invoiceId?: unknown }>).map(m => [String(m._id), m]));
    body.milestones = (body.milestones as Array<Record<string, unknown>>).map(m => {
      const old = m._id ? prev.get(String(m._id)) : undefined;
      return old ? { ...m, amount: old.amount, invoiceId: old.invoiceId } : m;
    });
  }
  item.set(body);
  // save() et non findOneAndUpdate : le calcul des taux (hook du modèle) s'applique.
  await item.save();
  await item.populate(MEMBERS, "firstName lastName");

  await logAudit(auth, "UPDATE", "projects", { resourceId: params.id });
  return ok(maskProjectMoney(item.toObject(), auth));
});

export const DELETE = withAuth("projects", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!Types.ObjectId.isValid(params.id)) return notFound();

  const deleted = await ProjectModel.findOneAndDelete({ _id: params.id, ...tenantFilter(auth), ...projectScope(auth) });
  if (!deleted) return notFound();

  await logAudit(auth, "DELETE", "projects", { resourceId: params.id });
  return noContent();
});
