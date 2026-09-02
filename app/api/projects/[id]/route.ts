import { NextRequest } from "next/server";
import { withAuth, ok, notFound, noContent, tenantFilter } from "@/lib/api-helpers";
import { ProjectModel } from "@/models/Project";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import { connectDB } from "@/lib/db";

export const GET = withAuth("projects", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();

  // SOLUTION : Extraire l'ID directement de l'URL puisque 'context' arrive undefined
  const id = req.nextUrl.pathname.split("/").pop(); 
  
  console.log(">>> [API GET] ID extrait manuellement de l'URL:", id);
  console.log(">>> [API GET] Tenant ID de l'utilisateur:", auth.tenantId);

  if (!id || id === "projects" || id === "undefined") {
    return notFound();
  }

  const item = await ProjectModel.findOne({ _id: id, ...tenantFilter(auth) })
    .populate("projectMembers.userId", "firstName lastName")
    .populate("projectMembers.memberId", "firstName lastName")
    .populate("projectMembers.bureauMemberId", "firstName lastName")
    .lean();

  if (!item) {
    console.warn(`>>> [API GET] Projet ${id} introuvable pour le tenant ${auth.tenantId}`);
    return notFound();
  }
  
  return ok(item);
});

export const PATCH = withAuth("projects", "update", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const id = req.nextUrl.pathname.split("/").pop();

  if (!id || id === "undefined") return notFound();

  const body = await req.json();
  const item = await ProjectModel.findOneAndUpdate(
    { _id: id, ...tenantFilter(auth) }, 
    body, 
    { new: true }
  ).populate("projectMembers.userId projectMembers.memberId projectMembers.bureauMemberId", "firstName lastName");

  if (!item) return notFound();
  
  await logAudit(auth, "UPDATE", "projects", { resourceId: id });
  return ok(item);
});

export const DELETE = withAuth("projects", "delete", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const id = req.nextUrl.pathname.split("/").pop();

  if (!id || id === "undefined") return notFound();

  const deleted = await ProjectModel.findOneAndDelete({ _id: id, ...tenantFilter(auth) });
  if (!deleted) return notFound();

  await logAudit(auth, "DELETE", "projects", { resourceId: id });
  return noContent();
});