import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, conflict, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { ActivityModel } from "@/models/Activity";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withAuth("analytics", "read", async (_req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const items = await ActivityModel.find({ ...tenantFilter(auth), archived: { $ne: true } }).sort({ name: 1 }).lean();
  return ok(items);
});

export const POST = withAuth("analytics", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  if (!name) return badRequest("Nom du secteur requis.");
  const exists = await ActivityModel.findOne({ ...tenantFilter(auth), name });
  if (exists) return conflict("Ce secteur existe déjà.");
  const item = await ActivityModel.create({
    tenantId: auth.tenantId, name: name.slice(0, 120),
    color: typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : undefined,
    createdBy: auth.userId,
  });
  await logAudit(auth, "CREATE", "analytics", { resourceId: item._id.toString(), metadata: { sector: name } });
  return created(item);
});
