import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, tenantFilter } from "@/lib/api-helpers";
import { CRMOpportunityModel } from "@/models/CRMOpportunity";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const PATCH = withAuth("clients", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json();

  // Ajouter les dates de clôture automatiquement selon le stage
  if (body.stage === "won" && !body.wonDate) body.wonDate = new Date();
  if (body.stage === "lost" && !body.lostDate) body.lostDate = new Date();

  const opp = await CRMOpportunityModel.findOneAndUpdate(
    { _id: params.id, ...tenantFilter(auth) },
    body, { new: true }
  );
  if (!opp) return notFound();

  await logAudit(auth, "UPDATE", "clients", { resourceId: params.id, after: { stage: body.stage } });
  return ok(opp);
});

export const GET = withAuth("clients", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const opp = await CRMOpportunityModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .populate("clientId", "name code email phone")
    .populate("assignedTo", "firstName lastName")
    .lean();
  if (!opp) return notFound();
  return ok(opp);
});
