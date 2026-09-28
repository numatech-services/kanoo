import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, tenantFilter, sanitizeBody } from "@/lib/api-helpers";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const PATCH = withAuth("comptoir", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const clean = sanitizeBody(body);
  const ALLOWED = ["name", "description", "activityId", "archived"];
  const update: Record<string, unknown> = {};
  for (const f of ALLOWED) { if (f in clean) update[f] = clean[f]; }
  const desk = await ActivityDeskModel.findOneAndUpdate(
    { _id: params.id, ...tenantFilter(auth) }, { $set: update }, { new: true }
  );
  if (!desk) return notFound("Comptoir introuvable");
  await logAudit(auth, "UPDATE", "comptoir", { resourceId: String(params.id) });
  return ok(desk);
});
