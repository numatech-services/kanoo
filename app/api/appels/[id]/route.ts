import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, noContent, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { AppelCandidatureModel } from "@/models/AppelCandidature";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const STATUS = ["identified", "preparing", "submitted", "evaluation", "won", "lost", "cancelled"];
const SCALARS = ["title", "organism", "reference", "estimatedAmount", "notes", "requiredDocuments", "documents"];

export const GET = withAuth("appels", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const item = await AppelCandidatureModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .populate("contractId", "reference title").populate("projectId", "name").lean();
  if (!item) return notFound("Appel introuvable");
  return ok(item);
});

export const PATCH = withAuth("appels", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const existing = await AppelCandidatureModel.findOne({ _id: params.id, ...tenantFilter(auth) }).lean<{ _id: unknown } | null>();
  if (!existing) return notFound("Appel introuvable");

  const set: Record<string, unknown> = {};
  for (const f of SCALARS) if (f in body) set[f] = body[f];
  if (body.status !== undefined) {
    if (!STATUS.includes(body.status)) return badRequest("Statut invalide.");
    set.status = body.status;
  }
  if ("submissionDeadline" in body) set.submissionDeadline = body.submissionDeadline ? new Date(body.submissionDeadline) : null;
  for (const f of ["contractId", "projectId"]) {
    if (!(f in body)) continue;
    set[f] = body[f] && Types.ObjectId.isValid(String(body[f])) ? body[f] : undefined;
  }

  const item = await AppelCandidatureModel.findByIdAndUpdate(params.id, { $set: set }, { new: true, runValidators: true }).lean();
  await logAudit(auth, "UPDATE", "appels", { resourceId: String(params.id) });
  return ok(item);
});

export const DELETE = withAuth("appels", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const res = await AppelCandidatureModel.deleteOne({ _id: params.id, ...tenantFilter(auth) });
  if (!res.deletedCount) return notFound("Appel introuvable");
  await logAudit(auth, "DELETE", "appels", { resourceId: String(params.id) });
  return noContent();
});
