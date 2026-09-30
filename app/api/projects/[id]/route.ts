import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { withAuth, ok, notFound, noContent, tenantFilter, sanitizeBody } from "@/lib/api-helpers";
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

const MEMBERS = "projectMembers.userId projectMembers.memberId projectMembers.bureauMemberId";

export const GET = withAuth("projects", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!Types.ObjectId.isValid(params.id)) return notFound();

  const item = await ProjectModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .populate(MEMBERS, "firstName lastName")
    .lean<Record<string, unknown> | null>();
  if (!item) return notFound();

  // Budget et montants : gérant et comptabilité seulement.
  return ok(maskProjectMoney(item, auth));
});

export const PATCH = withAuth("projects", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!Types.ObjectId.isValid(params.id)) return notFound();

  // Jamais le corps brut : ni tenantId, ni opérateur Mongo, ni montant fixé
  // par un compte sans accès aux finances.
  const body = stripProjectMoneyWrites(sanitizeBody(await req.json(), ["conversationId"]), auth);
  const item = await ProjectModel.findOneAndUpdate(
    { _id: params.id, ...tenantFilter(auth) },
    { $set: body },
    { new: true, runValidators: true }
  ).populate(MEMBERS, "firstName lastName");
  if (!item) return notFound();

  await logAudit(auth, "UPDATE", "projects", { resourceId: params.id });
  return ok(maskProjectMoney(item.toObject(), auth));
});

export const DELETE = withAuth("projects", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!Types.ObjectId.isValid(params.id)) return notFound();

  const deleted = await ProjectModel.findOneAndDelete({ _id: params.id, ...tenantFilter(auth) });
  if (!deleted) return notFound();

  await logAudit(auth, "DELETE", "projects", { resourceId: params.id });
  return noContent();
});
